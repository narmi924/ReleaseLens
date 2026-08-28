<p align="center">
  <img src="./docs/assets/releaselens-mark.svg" width="104" alt="ReleaseLens orbital mark">
</p>

<h1 align="center">ReleaseLens</h1>

<p align="center">
  Know what changed before you update a developer tool.<br>
  First-party release evidence for Codex, Claude Code, and Gemini CLI.
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

---

## What ReleaseLens is for

ReleaseLens is a public release-intelligence observatory for developer tools.
It watches first-party release surfaces, verifies what it can safely verify,
and turns a version number into an answer you can inspect:

- What is the current version in each official channel or distribution?
- Is the release merely visible, or is a verified artifact actually available?
- What changed between two releases—including command-line interface changes?
- Is there evidence of a distribution mismatch, a rollout race, or an incident?
- Which release is the Last Known Good (LKG) within the declared test scope?

> **ReleaseLens is not a changelog mirror and does not call a release “safe.”**
> It shows the evidence, the checks that ran, and the limits of those checks so
> you can decide what to investigate or update.

## Use it as a visitor

No account, local installation, or API key is needed to use a deployed
ReleaseLens site.

1. **Start at the dashboard** to see the latest observed state, release
   verdict, and LKG for each tool.
2. **Open a tool timeline** to follow its release and channel history.
3. **Open a release detail** when a version matters; it connects the verdict
   to source, artifact, interface, behavior, and community evidence.
4. **Compare two releases** to isolate version, distribution, and CLI-surface
   differences.
5. **Review incidents** when a regression or rollout anomaly is being tracked,
   or subscribe through RSS/Atom and the JSON API for your own monitoring.

## Practical situations

| If you are…                                   | ReleaseLens helps you…                                                                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Using Codex from the Windows Store            | Distinguish a Store catalog version from a verified downloadable x64 package, while keeping ARM64 rollout evidence visible without blocking the primary result.          |
| Maintaining Windows machines with Claude Code | See whether the official/native recommendation and WinGet package have drifted before treating them as the same release.                                                 |
| Trying Gemini CLI `preview` or `nightly`      | Check the channel version, registry integrity, package identity, and recorded CLI-interface changes before moving scripts or documentation forward.                      |
| Reviewing an upgrade or incident              | Link a concrete version change to first-party provenance, a deterministic verdict, and any related incident rather than relying on a screenshot or an unverified repost. |
| Building your own release monitor             | Consume versioned JSON, RSS, or Atom instead of scraping the website.                                                                                                    |

## What it watches today

| Product         | First-party release surfaces                                                                             | What the product view makes clear                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Codex**       | Microsoft Store DisplayCatalog, experimental FE3 metadata, and verified MSIX artifacts                   | Catalog visibility versus actual downloadability, x64 primary analysis, ARM64 rollout evidence, artifact identity, and bounded smoke results. |
| **Claude Code** | Official native/recommended distribution, Windows WinGet metadata, and optional official GitHub metadata | Official distribution state, Windows drift, verified isolated CLI checks, and community context.                                              |
| **Gemini CLI**  | npm registry `latest`, `preview`, and `nightly` dist-tags                                                | Channel history, SRI integrity, package inspection, CLI snapshots, and promotion evidence.                                                    |

## Read the evidence, not just the verdict

Every release observation separates the evidence that led to its conclusion:

```text
first-party source
  -> release candidate and source evidence
  -> temporary verified artifact and safe inspection/smoke
  -> diff, deterministic verdict, LKG, and incident lifecycle
  -> static website, versioned JSON API, RSS, and Atom
```

The site keeps the raw provenance available without making hashes and protocol
details the primary decision surface. Signed download URLs, credentials,
temporary paths, and process state are never persisted in public data.

## Use the data in your own workflow

After a static-site deployment, the following stable endpoints are available
from its base URL:

- `/api/v1/index.json` and `/api/v1/products.json` — current public index
- `/api/v1/products/<product>/latest.json` — latest state for one product
- `/api/v1/products/<product>/releases/<observation>.json` — one release and
  its evidence
- `/api/v1/incidents.json` — tracked incident lifecycle
- `/rss.xml` and `/atom.xml` — feed-friendly change monitoring

This makes ReleaseLens useful both as a human-readable observatory and as a
source for an upgrade checklist, an internal dashboard, or a notification
workflow.

## Run your own observer

This section is for contributors and operators—not required to use the public
site. It requires Node.js 22+ and pnpm 9+.

```powershell
pnpm install --frozen-lockfile
pnpm rl discover --all
pnpm rl observe --all
pnpm build
```

Observations use temporary directories, a temporary HOME/profile, and an
isolated npm prefix. Existing Codex, Claude Code, and Gemini CLI installations
on the machine are not installed, updated, downgraded, or removed. Large
artifacts are verified before execution and discarded after the observation.

For commands, local test rules, and cleanup, see
[local development](docs/local-development.md). For data flow and product
boundaries, see [architecture](docs/architecture.md),
[methodology](docs/methodology.md), [product profiles](docs/product-profiles.md),
and the [data schema](docs/data-schema.md).

## Scope and limits

- `NO_REGRESSION_DETECTED` means no regression was detected within the
  declared, executed test scope. It is not a safety, quality, or compatibility
  guarantee.
- Microsoft FE3 is an undocumented experimental adapter. DisplayCatalog
  visibility does not prove an artifact is downloadable; rollout races remain
  explicit, conservative evidence.
- Upstream APIs and delivery infrastructure can rate-limit or change. Those
  conditions become structured failure or unsupported evidence, never
  fabricated success.
- ReleaseLens does not retain installers, scan for malware, invoke models or
  paid APIs, or replace vendor support channels.

## License

[MIT](LICENSE)
