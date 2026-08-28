# 架构

ReleaseLens 将“发现版本”与“证明用户实际可获得的版本”分开。所有产品通过同一套领域模型输出证据，但每个上游的协议、制品格式和运行方式留在独立 adapter 中。

```mermaid
flowchart LR
  U[第一方上游] --> S[Source adapters]
  S --> C[ReleaseCandidate / SourceEvidence]
  C --> A[临时 artifact lease]
  A --> V[验证]
  V --> I[制品检查与接口观测]
  I --> B[隔离行为 smoke]
  C --> D[Diff engine]
  I --> D
  B --> D
  D --> R[确定性 verdict / LKG / incidents]
  R --> G[canonical data/]
  G --> P[static publisher]
  P --> W[Next static website]
  P --> J[/api/v1 JSON]
  P --> F[RSS / Atom]
```

## 模块边界

| 模块                                               | 责任                                                   | 明确不负责                   |
| -------------------------------------------------- | ------------------------------------------------------ | ---------------------------- |
| `packages/core`                                    | Zod 领域模式、版本比较、产品 profile、canonical JSON   | HTTP、子进程、产品特例       |
| `packages/platform/sources`                        | 第一方发现、指纹、源失败分类、Store rollout 策略       | 持久化签名 URL、最终判定     |
| `packages/platform/artifacts`                      | 临时 lease、原子下载、重试、hash/integrity、执行前许可 | 长期二进制存储或镜像         |
| `packages/platform/inspectors`                     | MSIX、Codex Electron、npm 包的离线检查                 | 全局安装目标工具             |
| `packages/platform/interface` / `runners`          | 有时限的隔离 `--version`/`--help`/安全诊断与能力检测   | 登录、模型调用或副作用工作流 |
| `packages/platform/diff` / `verdict` / `incidents` | 结构化变化、确定性状态、LKG、incident 生命周期         | LLM 评分或黑盒风险分         |
| `packages/platform/orchestrator`                   | 幂等观察、canonical data、索引                         | Web 展示逻辑                 |
| `packages/platform/publication`                    | 从 canonical data 生成静态 JSON/RSS/Atom，并验证发布物 | API 服务端、数据库           |
| `apps/cli`                                         | 本地和 CI 命令入口                                     | 产品业务规则                 |
| `apps/web`                                         | 只读取静态、公开、安全的数据并呈现产品界面             | 直接请求供应商、下载制品     |

开发期间使用的研究镜像、设计参考和执行计划刻意留在被忽略的本地 `Local/` 工作区；公开仓库的运行时、构建和测试不依赖它们。

## Codex Microsoft Store 流水线

Codex 的 Store adapter 由以下可替换子边界组成：

```text
DisplayCatalog client
  -> catalog product / WuCategoryId / visible version
FE3 experimental resolver
  -> GetCookie -> SyncUpdates -> PackageMoniker -> GetExtendedUpdateInfo2
package selector
  -> x64 primary; ARM64 secondary evidence
consistency policy
  -> catalog-versus-FE3 rollout race diagnosis
runtime artifact resolver
  -> short-lived Microsoft delivery URL only in memory
```

DisplayCatalog 是目录可见性的官方 Store 表面；FE3 是 Windows Update/Store 所使用的未文档化协议，故隔离在实验 adapter 中。对 x64，只有可选择的 FE3 package moniker 与目录元数据一致时才可进入 acquire。ARM64 的目录/下载状态会被记录，但不能阻塞 x64 的主观察。

当目录版本领先于 FE3，或 moniker、架构、版本不一致时，系统输出 rollout/inconsistency 证据，拒绝将它描述为已验证下载。下载 URL 在实际 acquire 时重新解析，限定 Microsoft delivery host，并在进程退出前删除；持久化的仅是安全的 host、文件名、大小、hash、身份、版本与检查结果。

## 生命周期、幂等与安全

一次制品流程是严格的短 lease：

```text
discover -> resolve -> atomic temp download -> verify -> inspect -> safe smoke -> extract evidence -> delete
```

下载采用有界重试和临时文件再原子落位。MSIX 在执行前核对 SHA-256、identity、架构、manifest/version、重要入口和可用时的签名/区块映射；npm 在解压/运行前核对 registry SRI、name/version 与 manifest。无论成功或失败，lease 都清理本地制品。

源 fingerprint、候选版本和 canonical 内容使重复观察幂等。数据仓库只在 canonical JSON 实质不同的时候写入，并重建 latest/LKG 索引；GitHub 的观察工作流只提交 `data/` 的实质变化。临时 URL、查询参数、header、HOME、绝对临时路径和大日志均被持久化边界拒绝。

## 从数据到静态产品

`data/` 是唯一 canonical source of truth。发布器在构建时读取已验证的 observation、diff、incident 和 index，生成 `/api/v1`、RSS、Atom；web 应用从这些静态资源读取，不在浏览器或站点构建期间重新探测上游。

`validate-public` 校验每个输出 JSON 的 canonical 编码、schema、交叉引用、产品/版本索引、每个 observation/diff/incident 的路径，以及 RSS/Atom XML 结构。它还拒绝签名 URL 查询字段和本地临时路径进入公开发布物。

## 自动化拓扑

每小时的 Windows hosted workflow 使用不取消正在运行作业的 concurrency group：相邻小时会排队而不是中断正在进行的分析。它验证 data，再仅对变化的 `data/` 提交；有变化时同一工作流会检出刚推送的 `main` 分支尖端，在 hosted runner 上构建、验证并部署 Pages，因此不会依赖 bot commit 再次触发 `push` 工作流。CI 在 Linux/Windows 上运行质量门，并将真实目标工具 smoke 放入临时 profile/prefix；source discovery 也在 hosted runner 上运行。普通 `main` 推送仍由 Pages workflow 从同一静态构建输出部署。
