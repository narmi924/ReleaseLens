# 方法学

ReleaseLens 的结论由可追溯的结构化证据产生，不使用 LLM 判定，也不生成黑盒分数。每份 observation 都声明发现时间、渠道、平台、来源、检查范围和 verdict 原因。

## 证据类型

| 类型                | 回答的问题                             | 典型例子                                                                                    |
| ------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------- |
| `SourceEvidence`    | 上游声称/暴露了什么？                  | Store catalog、FE3 package metadata、npm dist-tag、官方安装页、WinGet、官方 GitHub metadata |
| `ArtifactEvidence`  | 实际临时制品是否与声称身份一致？       | SHA-256、SRI、MSIX identity/version/arch、npm name/version/manifest                         |
| `InterfaceEvidence` | 已暴露的非登录 CLI 表面是什么？        | `--version`、`--help`、顶级命令、稳定 flags/config/env keys                                 |
| `BehaviorEvidence`  | 声明的安全 smoke 是否实际通过？        | 隔离 `--version`、`--help`、安全诊断、能力门控的 desktop startup                            |
| `CommunityEvidence` | 官方仓库近期是否出现可聚类的回归信号？ | issue 标题/标签/显式版本、维护者确认、规范化错误 signature                                  |

每条证据都有 `pass`、`fail`、`warning`、`info` 或 `unsupported`。`unsupported` 是能力不具备时的诚实结果，不会被伪造为通过；它是否阻止 LKG 由产品 profile 的 required checks 决定。

## 判定与 LKG

Verdict 是确定性优先级规则的结果，并引用其原因和 evidence ID：

1. 缺少 required evidence、关键验证失败或必需行为未通过：`UNVERIFIED` 或回归类状态。
2. 多个相关官方分发面版本不一致：`DISTRIBUTION_DRIFT`。
3. 有结构化行为/接口/社区回归证据：`SUSPECTED_REGRESSION`；强确认条件满足时为 `CONFIRMED_REGRESSION`。
4. 通过已声明 required scope，且无更高优先级原因：`NO_REGRESSION_DETECTED`。
5. 有材料性变化但未触发上述情况时：`CHANGED`。

Latest 和 LKG 是不同的东西。Latest 是按产品 profile 的版本规则和渠道/平台选出的当前上游状态；LKG 是最近一个满足该 profile 所需证据、行为测试和可接受 verdict 的 observation。`NO_REGRESSION_DETECTED` 只代表观测的有限范围内未发现问题，绝非安全性、稳定性或适用性保证。

## Diff 与 incidents

每个可比较 observation 保存一个 `ReleaseDiff`，分为 artifact、interface、behavior、distribution 和 material changes。只将结构化、语义性变化写入，避免帮助文本措辞或观察时间造成噪声。

当 verdict 变为 `SUSPECTED_REGRESSION` 或 `CONFIRMED_REGRESSION` 时，确定性 incident reconciler 依据产品、版本和规范化 signature 打开/关联 incident。后续证据可将其置为 monitoring，满足清除规则的后续 release 可将其 resolved；历史不会被删除。社区刷新不重新下载制品。

## 上游与稳定性边界

- Codex DisplayCatalog 是 Store 的目录表面；FE3 是未文档化、实验性的下载元数据解析器。两者在 rollout 中可以暂时不一致。
- Claude Code 的官方安装页/native release 与 WinGet 是不同分发面；二者不一致是有价值的 drift 事实，而不是自动判定任一方错误。
- Gemini CLI 的 npm registry dist-tags 是通道的 source of truth；`gitHead` 等可选元数据只用于增强 promotion lineage，缺失时明确标记未知。
- 官方 GitHub API 是社区证据来源之一，但它可能限流；限流只降低可观察性，不能演绎成没有回归。

## 明确不宣称的能力

ReleaseLens 不镜像安装器、不长期保存二进制、不扫描恶意软件、不执行模型调用或认证工作流，不代表供应商，也不替代完整的端到端测试、企业兼容性测试或供应商支持。完整测试/执行约束见 [本地开发](local-development.md)。
