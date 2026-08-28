# Canonical 数据与静态 API

`data/` 是 ReleaseLens 的 canonical 数据源。所有 JSON 都由 `canonicalJson` 写入：稳定 key order、末尾换行、schema version 和严格 runtime schema。数据仓库在读取时重新校验 schema 与 canonical 表示，引用不存在的 observation/diff/incident 会失败。

## 目录

```text
data/
  observations/<product>/<observationId>.json
  diffs/<product>/<diffId>.json
  incidents/<incidentId>.json
  channel-history/gemini-cli/<sourceFingerprint>.json
  indexes/products.json
  indexes/latest.json
  indexes/known-good.json
```

所有 V1 domain document 当前使用 `schemaVersion: 1`。不兼容变更必须引入新版本、迁移路径和对应读取逻辑；不能静默重新解释旧记录。

## 主要文档

| 文档                     | 必需身份字段                                                                 | 核心内容                                                      |
| ------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `ReleaseObservation`     | `observationId`、产品、canonical/source version、channel、platform、发现时间 | 五类 evidence、可选 `comparedWith`、deterministic verdict     |
| `ReleaseDiff`            | `diffId`、产品、observation/previous observation                             | artifact/interface/behavior/distribution/material changes     |
| `Incident`               | incident ID、产品、状态、受影响 observation                                  | signature、evidence refs、opened/monitoring/resolved timeline |
| `LatestIndex`            | product/channel/platform、observation ID、version                            | 当前观察状态与 verdict                                        |
| `KnownGoodIndex`         | product/channel/platform、observation ID、version                            | 满足 profile policy 的最近 observation                        |
| `ChannelHistorySnapshot` | product、observedAt、source fingerprint                                      | Gemini channel version/integrity/git identity 变化            |

Evidence item 统一携带 `id`、`kind`、`status`、`summary`、可选结构化 `details`、`observedAt`。Artifact、source、interface、behavior 和 community evidence 各自有额外严格字段；详细 runtime schema 位于 `packages/core/src/models.ts`。

## 禁止持久化的运行时状态

Canonical data 和 public API 不得包含：签名 CDN URL 或查询参数、authorization/cookie/header、临时或绝对本地路径、HOME/profile、进程句柄、secret、安装器二进制或大日志。Microsoft delivery host、非敏感 package moniker、文件名、hash、大小、identity 和版本可作为证据持久化。

## 静态 API v1

构建器从 canonical data 生成以下可部署资源（`apps/web/public/api/` 为 ignored build output）：

```text
/api/v1/index.json
/api/v1/products.json
/api/v1/latest.json
/api/v1/known-good.json
/api/v1/products/<product>.json
/api/v1/products/<product>/index.json
/api/v1/products/<product>/latest.json
/api/v1/products/<product>/known-good.json
/api/v1/products/<product>/releases.json
/api/v1/products/<product>/releases/<observationId>.json
/api/v1/products/<product>/incidents.json
/api/v1/releases/<observationId>.json
/api/v1/diffs/<diffId>.json
/api/v1/incidents.json
/api/v1/incidents/<incidentId>.json
/rss.xml
/atom.xml
```

`index.json` 提供产品摘要与 incident 摘要；product document 提供 channels、latest、LKG 与简洁 release references；单 release/diff/incident 端点提供完整原始结构化证据。RSS/Atom 只描述可公开的 latest 事件，并链接回 release detail。

`pnpm rl validate-public` 会解析所有生成 JSON，验证 canonical 编码、核心 schemas、cross-reference、每个 product 的两种 index 路径、公开 release/diff/incident 文档和 RSS/Atom XML。它是 CI/发布前的可执行边界，而不是人工审查约定。
