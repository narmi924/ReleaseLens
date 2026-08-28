<p align="center">
  <img src="./docs/assets/releaselens-mark.svg" width="104" alt="ReleaseLens orbital mark">
</p>

<h1 align="center">ReleaseLens</h1>

<p align="center">
  在更新开发工具前，先弄清楚到底变了什么。<br>
  为 Codex、Claude Code 与 Gemini CLI 提供可追溯的第一方发布证据。
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
  <a href="./README.md">English</a> · <strong>中文</strong>
</p>

---

## 这个项目能做什么

ReleaseLens 是面向开发者工具的公开发布情报站。它观察第一方发布面，
在安全可行的范围内验证证据，并把单纯的版本号变成可追溯的结论：

- 各官方通道或分发面的当前版本是什么？
- 某版本只是“被目录列出”，还是确有已验证的可下载制品？
- 两个 release 之间改了什么，包括命令行接口的变化？
- 是否存在分发不一致、灰度 rollout race 或已跟踪的 incident？
- 在已声明的测试范围内，哪个版本是 Last Known Good（LKG）？

> **ReleaseLens 不是 changelog 镜像，也不会把任何 release 宣称为“安全”。**
> 它展示证据、实际执行过的检查，以及检查的边界，让你自己决定该调查或升级什么。

## 作为访客如何使用

使用已部署的 ReleaseLens 站点不需要账号、本地安装或 API key。

1. **从 Dashboard 开始**：查看每个工具最近一次观察到的状态、release verdict 与 LKG。
2. **打开工具时间线**：追踪该工具的 release 与 channel 历史。
3. **打开 release 详情**：当某个版本与你有关时，查看它的 source、artifact、interface、behavior 与 community evidence。
4. **比较两个 release**：定位版本、分发面与 CLI 表面的具体差异。
5. **查看 incidents**：在回归或 rollout 异常被跟踪时了解其进展；也可以通过 RSS/Atom 或 JSON API 接入自己的监控。

## 实际使用场景

| 当你…                                     | ReleaseLens 可以帮你…                                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 通过 Windows Store 使用 Codex             | 区分 Store catalog 版本与已验证的可下载 x64 package；同时展示 ARM64 rollout 证据而不阻塞主结论。               |
| 维护安装了 Claude Code 的 Windows 设备    | 在把它们当成同一个 release 之前，先看到官方/native recommendation 与 WinGet package 是否出现版本漂移。         |
| 尝试 Gemini CLI 的 `preview` 或 `nightly` | 在更新脚本或文档前，核对 channel version、registry integrity、package identity 与已记录的 CLI interface 变化。 |
| 审核一次升级或 incident                   | 将具体版本变化关联到第一方来源、确定性 verdict 与相关 incident，而不是依赖截图或未经验证的转述。               |
| 构建自己的 release monitor                | 直接消费带版本的 JSON、RSS 或 Atom，而不是抓取网页。                                                           |

## 当前观察哪些发布面

| 产品            | 第一方发布面                                                                      | 产品页会明确告诉你什么                                                                                            |
| --------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Codex**       | Microsoft Store DisplayCatalog、实验性 FE3 metadata、已验证的 MSIX artifact       | catalog 可见性与实际可下载性的区别、x64 主分析、ARM64 rollout evidence、artifact identity 与有边界的 smoke 结果。 |
| **Claude Code** | 官方 native/recommended 分发、Windows WinGet metadata、可选的官方 GitHub metadata | 官方分发状态、Windows 版本漂移、经过验证的隔离 CLI 检查与 community context。                                     |
| **Gemini CLI**  | npm registry 的 `latest`、`preview`、`nightly` dist-tags                          | channel history、SRI integrity、package inspection、CLI snapshots 与 promotion evidence。                         |

## 看证据，而不只看 verdict

每个 release observation 都会分开保留得出结论所需的证据：

```text
第一方 source
  -> release candidate 与 source evidence
  -> 临时且经过验证的 artifact 与安全 inspection/smoke
  -> diff、deterministic verdict、LKG 与 incident lifecycle
  -> static website、versioned JSON API、RSS 与 Atom
```

站点会保留可展开的原始 provenance，但不会让 hash 与协议细节主导你的决策。
签名下载 URL、凭据、临时路径与进程状态绝不会写入公开数据。

## 把数据接入自己的工作流

静态站点部署完成后，以下稳定端点会在其 base URL 下提供：

- `/api/v1/index.json` 与 `/api/v1/products.json`：当前公开索引
- `/api/v1/products/<product>/latest.json`：单个产品的当前状态
- `/api/v1/products/<product>/releases/<observation>.json`：一个 release 及其证据
- `/api/v1/incidents.json`：已跟踪的 incident lifecycle
- `/rss.xml` 与 `/atom.xml`：适合订阅的变更 feed

因此 ReleaseLens 既可作为人可读的观察站，也可作为升级 checklist、内部 dashboard 或通知工作流的数据源。

## 运行自己的 observer

本节面向贡献者与运营者；使用公开站点不需要执行这些命令。要求 Node.js 22+ 与 pnpm 9+：

```powershell
pnpm install --frozen-lockfile
pnpm rl discover --all
pnpm rl observe --all
pnpm build
```

观察过程只使用临时目录、临时 HOME/profile 与隔离的 npm prefix。它不会安装、更新、降级或卸载机器上已有的 Codex、Claude Code 或 Gemini CLI。大制品会在执行前验证，并在本次观察后删除。

命令、本地测试规则与清理方式见[本地开发](docs/local-development.md)。数据流与产品边界见[架构](docs/architecture.md)、[方法学](docs/methodology.md)、[产品配置](docs/product-profiles.md)与[数据模式](docs/data-schema.md)。

## 范围与限制

- `NO_REGRESSION_DETECTED` 仅表示在已声明且实际执行的测试范围内没有发现回归；不是安全、质量或兼容性保证。
- Microsoft FE3 是未文档化的实验性 adapter。DisplayCatalog 可见不代表 artifact 可下载；rollout race 会保留为明确、保守的证据。
- 上游 API 与分发基础设施可能限流或变化。这些情况会成为结构化的失败或 unsupported evidence，绝不会伪造成功。
- ReleaseLens 不保留 installer、不做恶意软件扫描、不调用模型或付费 API，也不替代供应商支持渠道。

## 许可证

[MIT](LICENSE)
