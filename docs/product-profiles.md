# 产品配置

三个 V1 profile 共享 evidence/diff/verdict 引擎，却不能共用一个“latest version”适配器：它们的发行面、验证方式和可安全执行的检查不同。

## Codex：Microsoft Store / MSIX

| 层             | 作用                                 | V1 行为                                                                                                           |
| -------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| DisplayCatalog | 目录可见、产品版本、`WuCategoryId`   | 作为 catalog evidence，不等价于可下载性。                                                                         |
| FE3（实验）    | Store/Windows Update 可下载 metadata | 经过 cookie/sync/moniker/extended-info 链路选择 package；不将该未文档化协议漏入 core。                            |
| selector       | x64 与 ARM64                         | x64 是必需主路径；ARM64 仅作 rollout/distribution evidence，绝不阻塞 x64。                                        |
| resolver       | 临时 Microsoft CDN URL               | acquire 时重新解析，限制 host，绝不持久化签名查询参数。                                                           |
| MSIX inspector | 身份与包内容                         | 校验 identity、version、architecture、manifest、入口、hash 和可用签名/区块映射；Codex Electron 细节是产品扩展。   |
| runners        | 后端/桌面 smoke                      | 只在制品通过验证后，于临时环境运行安全 backend probe；desktop startup 依赖 Windows/GUI 能力，否则 `unsupported`。 |

关键事实是“目录版本”和“FE3 可下载版本”可以在 rollout race 中分歧。Catalog-ahead/FE3-behind、moniker drift、ARM64 暂不可得都会显示为显式证据；系统拒绝把它们粉饰成已验证的新 release。

## Claude Code：官方 native 与 Windows 分发漂移

Claude Code profile 读取供应商安装/发布面取得 recommended/native 版本，同时读取 `Anthropic.ClaudeCode` 的 WinGet metadata。它们同为相关分发事实，但不应被合并成一个未经解释的“latest”。

官方 GitHub repository metadata 是可选的补充来源和社区证据来源。若 GitHub API 限流，核心 official/native 与 WinGet 观察仍会照实落库，source failure 会明确显示。对于验证过的临时 native artifact，ReleaseLens 在临时 HOME/profile 和隔离位置运行 `claude --version`、`claude --help` 和安全诊断；不登录、不调用模型、不改动开发机现有 Claude Code。

当 native/recommended 与 WinGet 版本不同，verdict 是 `DISTRIBUTION_DRIFT`，即使之前的相同版本仍可作为 LKG。

## Gemini CLI：npm release channels

Gemini CLI profile 以 npm registry 的 `latest`、`preview`、`nightly` dist-tags 为通道 source of truth。每个通道各自是一个可比较的 latest/LKG 轨道。

针对新版本，适配器读取版本、tarball、SRI integrity、shasum、published time 和可用的 `gitHead`；下载后必须通过 integrity、package name/version 和 `package.json` 检查才可执行。它以临时 npm prefix/HOME 运行 `gemini --version` 与 `gemini --help`，生成接口快照，不触发登录或模型调用。只有通道实际推进时才写入 Gemini channel-history；可用 source identity 支持 promotion evidence，缺失时不会猜测。

## 添加第四个产品

新增产品不应复制一个巨大的流程。应当：

1. 在 `products/` 定义带版本方案、渠道、必需证据、能力和 LKG policy 的 profile。
2. 仅实现该上游需要的 source adapter、artifact resolver/inspector 与安全 runner plan。
3. 复用 core schema、canonical repository、diff、verdict、incident 和静态发布器。
4. 为 parser、错误处理、制品验证、runner capability 与真实 source discovery 添加 fixtures/测试。
5. 只有真实第一方 observation 才能进入 `data/` 与生产页面。
