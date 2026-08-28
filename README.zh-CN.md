<p align="center">
  <img src="./docs/assets/releaselens-mark.svg" width="104" alt="ReleaseLens orbital mark">
</p>

<h1 align="center">ReleaseLens</h1>

<p align="center">
  面向开发者工具的发布情报与回归观察站。<br>
  以可追溯的第一方证据，回答「究竟变了什么？」。
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

<p align="center">
  <a href="./docs/architecture.md">架构</a> ·
  <a href="./docs/methodology.md">方法学</a> ·
  <a href="./docs/product-profiles.md">产品配置</a> ·
  <a href="./docs/data-schema.md">数据模式</a> ·
  <a href="./docs/local-development.md">本地开发</a>
</p>

---

ReleaseLens V1.0 是一个静态、证据优先的发布情报产品：规范化观察历史保存在 Git；大制品只在单次观察中临时下载、验证、检查/测试后删除。它没有数据库、账号系统、付费对象存储或常驻后端。

## 你会得到什么

| 产品        | V1 发布模型                               | 关键结论                                                                                                 |
| ----------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Codex       | Microsoft Store / MSIX                    | DisplayCatalog 的“目录可见”与实验性 FE3 的“可下载”分开建模；x64 是主分析对象，ARM64 是非阻塞的分发证据。 |
| Claude Code | 官方 native/recommended 与 Windows WinGet | 对比多个官方/官方推荐分发面，明确显示版本漂移，而不擅自更新本机安装。                                    |
| Gemini CLI  | npm `latest` / `preview` / `nightly`      | 校验 registry integrity 和包内容，记录通道历史、接口快照与通道推进证据。                                 |

真实观察数据位于 [`data/`](data/)，测试夹具只位于 [`fixtures/`](fixtures/)，永远不会出现在生产页面或静态 API 中。研究材料、阶段计划与操作说明只保留在被忽略的本地 `Local/`，不会进入公开仓库。

## 从上游到可读结论

```text
第一方上游
  -> source adapter -> candidate / SourceEvidence
  -> 临时 artifact lease -> verify -> inspect / smoke
  -> diff + deterministic verdict + LKG + incident
  -> canonical Git data -> static JSON API / RSS / Atom / website
```

所有领域对象均有 schema version：`SourceEvidence`、`ArtifactEvidence`、`InterfaceEvidence`、`BehaviorEvidence`、`CommunityEvidence`、`ReleaseDiff`、`ReleaseVerdict`、LKG 与 Incident 都是可查证的一等数据。运行时的签名下载 URL、认证信息、临时路径和进程状态不可序列化到 `data/` 或公共站点。

模块边界、数据流及自动化见 [架构文档](docs/architecture.md)；判定规则和已声明的测试范围见 [方法学](docs/methodology.md)。

## 快速开始

要求：Node.js 22+ 与 pnpm 9+。不要用这些命令安装、降级、升级或卸载开发机上已有的 Codex、Claude Code 或 Gemini CLI。

```powershell
pnpm install --frozen-lockfile
pnpm rl doctor
pnpm rl validate-data
pnpm build
pnpm e2e
```

常用观察命令：

```powershell
pnpm rl discover --all
pnpm rl observe --all
pnpm rl observe --product gemini-cli --force
pnpm rl refresh-community --recent 72h
pnpm rl build-public
pnpm rl validate-public
```

`observe` 只使用临时目录、临时 HOME/profile 和隔离的 npm prefix；只有通过所需验证的制品才会被执行。详细的本地开发、测试和清理规则见 [本地开发](docs/local-development.md)。

## 最终交付物

执行 `pnpm build` 会生成静态 Next.js 站点及其版本化资源。核心入口包括：

- `/api/v1/index.json`、`/api/v1/products.json`
- `/api/v1/products/<product>/latest.json`
- `/api/v1/products/<product>/releases/<observation>.json`
- `/api/v1/incidents.json`
- `/rss.xml` 与 `/atom.xml`

`apps/web/public/api/` 和 Feed 是可再生成的构建输出，不提交到 Git。部署后，访问者得到的是一个可浏览的 ReleaseLens 站点，同时也能直接消费上述稳定 JSON 和 Feed；端点字段、关联和安全限制见 [数据模式](docs/data-schema.md)。

## 部署到 GitHub Pages

仓库包含三项 GitHub Actions：

- `observe.yml`：每小时及手动触发，在 Windows hosted runner 上串行保护地观察；仅当 `data/` 有实质变化时提交，并在这种情况下构建、验证和发布 Pages。
- `ci.yml`：跨平台单元、集成、构建、Playwright、隔离工具 smoke 和第一方源探测。
- `deploy-pages.yml`：每次推送 `main` 后构建并部署静态导出到 GitHub Pages。

首次部署只需要：创建公开 GitHub 仓库、推送 `main`、然后在 **Settings → Pages** 将 source 设为 **GitHub Actions**。工作流会从 GitHub Pages 的官方配置读取站点 `base_url` 与 `base_path`，因此项目页、用户页和已配置的自定义域名都无需改代码。默认项目页地址是 `https://<owner>.github.io/<repository>/`；尚未配置自定义域名时，不会凭空拥有独立域名。

无需配置数据库、对象存储或服务器。推送初始提交会触发 CI 与一次 Pages 构建/部署；之后 `observe.yml` 每小时在 GitHub 托管 Windows runner 上观察上游，只有 `data/` 出现实质变化才创建 bot 提交并重新发布站点。

## 重要限制

- `NO_REGRESSION_DETECTED` 仅表示 ReleaseLens 声明的、已运行的验证范围内未检测到回归；不是安全、质量或适配性保证。
- Microsoft FE3 是未文档化且可能变化的实验适配器。DisplayCatalog 可见不等于制品可下载；任何 rollout race 都会保守地保留为未验证证据。
- GitHub API、WinGet 及上游发布基础设施可能限流或改变；这些情形会作为结构化的失败/不支持证据呈现，不会伪造成功。
- ReleaseLens 不保留安装包，不做恶意软件扫描，不调用模型/API，也不替代供应商支持渠道。

各产品的发布面差异见 [产品配置](docs/product-profiles.md)。

## 许可证

[MIT](LICENSE)
