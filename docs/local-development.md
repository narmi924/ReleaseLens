# 本地开发与安全运行

## 前置条件

- Node.js 22 或更高版本
- pnpm 9 或更高版本
- 对真实上游探测的网络访问
- Playwright Chromium（首次需要执行 `pnpm exec playwright install chromium`）

```powershell
pnpm install --frozen-lockfile
pnpm rl doctor
```

不要以管理员权限运行常规开发命令。ReleaseLens 不要求、也不应该使用个人 OpenAI、Anthropic、Google 或其他付费 API 凭据。

## 常用命令

| 命令                                     | 作用                                                 |
| ---------------------------------------- | ---------------------------------------------------- |
| `pnpm rl doctor`                         | 校验 product profiles 和宿主基本能力。               |
| `pnpm rl discover --all`                 | 只读地探测所有第一方 source。                        |
| `pnpm rl observe --all`                  | 运行完整、可幂等的当前观察；可能临时获取新的制品。   |
| `pnpm rl observe --product <id> --force` | 对一个 profile 强制重新观察。                        |
| `pnpm rl refresh-community --recent 72h` | 仅刷新官方 GitHub community metadata，不下载制品。   |
| `pnpm rl validate-data`                  | 校验 canonical data、schema、关联和索引。            |
| `pnpm rl build-public`                   | 生成 `/api/v1` 与 Feed。                             |
| `pnpm rl validate-public`                | 校验已生成静态 API 与 RSS/Atom。                     |
| `pnpm test`                              | 单元、fixture、integration 测试。                    |
| `pnpm lint` / `pnpm typecheck`           | 静态质量门。                                         |
| `pnpm build`                             | 生成公开数据并执行 production static build。         |
| `pnpm e2e`                               | 对 production static export 运行 Playwright 主流程。 |

可使用 `pnpm tsx scripts/serve-static.ts` 在本机提供 `apps/web/out` 的静态预览；必须先运行 `pnpm build`。

## 目标工具保护规则

开发、CI 和真实 smoke 都不得修改当前已安装的 Codex、Claude Code 或 Gemini CLI。实现采用以下约束：

- 制品使用临时 extraction/lease；成功或失败都删除。
- CLI smoke 使用临时 HOME/profile 和隔离 npm prefix。
- 下载在 hash/integrity/identity 通过前绝不执行。
- 禁止全局 npm install、Store 安装/更新、升级/降级/卸载目标工具。
- GUI 或 Windows-only 系统检查在无合法能力时返回 `unsupported`；它们可由 ephemeral Windows hosted runner 覆盖，不能伪造本机通过。

遇到必要 source 的真实网络失败时，先查看结构化错误与 `pnpm rl discover --product <id>`；不要用 fixture 或手工伪造生产 observation 取代它。可选 GitHub source 的限流会被保留为 evidence，不代表产品 release 不存在。

## 推荐开发节奏

1. 针对一个 adapter/inspector/rule 做修改。
2. 先运行相关 Vitest 文件或 CLI fixture，再运行对应 broader suite。
3. 修改 public shape 后运行 `pnpm rl build-public` 与 `pnpm rl validate-public`。
4. Web 修改后运行 `pnpm build` 和 `pnpm e2e`。
5. 提交前运行 `pnpm test`、`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm e2e`。

## Git 与临时输出

`data/` 是可提交的 canonical 历史；`apps/web/public/api/`、RSS/Atom、`.next`、`out`、test reports、lease/cache 和下载制品是 ignored 输出。`Local/` 是被忽略的私有工作区，可保存研究镜像、设计参考、计划和操作说明；它绝不可 stage，公开 clone 也不依赖它。

完成运行后，可安全删除忽略的 `apps/web/.next`、`apps/web/out`、`apps/web/public/api`、Feed、`test-results`、`playwright-report` 和项目临时 lease/cache。不要删除 `data/`、`fixtures/` 或 `node_modules/`，除非你明确要重建环境。
