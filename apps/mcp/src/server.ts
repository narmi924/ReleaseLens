import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
  Incident,
  KnownGoodPointer,
  LatestReleasePointer,
  ReleaseObservation,
} from "@releaselens/core";
import { z } from "zod";
import type { ProductDocument, ReleaseLensClient } from "./client";

export const SCOPE_CAVEAT =
  "Verdicts describe ReleaseLens's declared test scope only. NO_REGRESSION_DETECTED means no regression was detected within that scope; it is not a safety, quality, or compatibility guarantee, and Last Known Good is not an upgrade recommendation.";

const instructions = [
  "ReleaseLens observes first-party release channels for developer tools (Codex, Codex CLI, Claude Code, Gemini CLI), verifies temporary artifacts, and publishes deterministic, evidence-linked verdicts.",
  "Use list_products to see what is tracked, get_release_status for the current Latest and Last Known Good of a product, check_version before upgrading to a specific version, get_release_evidence to inspect why a verdict was reached, and list_incidents for tracked regressions.",
  SCOPE_CAVEAT,
].join(" ");

function ok(payload: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

function failure(error: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: error instanceof Error ? error.message : String(error),
      },
    ],
    isError: true,
  };
}

async function guarded(
  operation: () => Promise<unknown>,
): Promise<CallToolResult> {
  try {
    return ok(await operation());
  } catch (error) {
    return failure(error);
  }
}

function verdictView(verdict: LatestReleasePointer["verdict"]) {
  return {
    status: verdict.status,
    severity: verdict.severity,
    reasons: verdict.reasons.map((reason) => reason.message),
  };
}

function latestView(client: ReleaseLensClient, pointer: LatestReleasePointer) {
  return {
    channel: pointer.channel,
    ...(pointer.platform ? { platform: pointer.platform } : {}),
    version: pointer.version,
    observedAt: pointer.discoveredAt,
    verdict: verdictView(pointer.verdict),
    observationId: pointer.observationId,
    url: client.releasePageUrl(pointer.productId, pointer.observationId),
  };
}

function knownGoodView(client: ReleaseLensClient, pointer: KnownGoodPointer) {
  return {
    channel: pointer.channel,
    ...(pointer.platform ? { platform: pointer.platform } : {}),
    version: pointer.version,
    selectedAt: pointer.selectedAt,
    requirementsSatisfied: pointer.requirementsSatisfied,
    observationId: pointer.observationId,
    url: client.releasePageUrl(pointer.productId, pointer.observationId),
  };
}

function channelStatus(
  client: ReleaseLensClient,
  document: ProductDocument,
  channel: string,
) {
  const latest = document.latest.filter(
    (pointer) => pointer.channel === channel,
  );
  const knownGood = document.knownGood.filter(
    (pointer) => pointer.channel === channel,
  );
  const latestIsKnownGood =
    latest.length > 0 &&
    latest.every((pointer) =>
      knownGood.some(
        (candidate) => candidate.observationId === pointer.observationId,
      ),
    );
  const name = document.product.name;
  const summary =
    latest.length === 0
      ? `${name} has no observed release on the ${channel} channel yet.`
      : knownGood.length === 0
        ? `${name} ${latest[0]!.version} is the latest ${channel} release (${latest[0]!.verdict.status}); no release on this channel has satisfied the Last Known Good requirements yet.`
        : latestIsKnownGood
          ? `${name} ${latest[0]!.version} is the latest ${channel} release and is the current Last Known Good (${latest[0]!.verdict.status}).`
          : `${name} ${latest[0]!.version} is the latest ${channel} release (${latest[0]!.verdict.status}); the Last Known Good is still ${knownGood[0]!.version}.`;
  return {
    channel,
    summary,
    latest: latest.map((pointer) => latestView(client, pointer)),
    knownGood: knownGood.map((pointer) => knownGoodView(client, pointer)),
    latestIsKnownGood,
  };
}

function observationDigest(
  client: ReleaseLensClient,
  observation: ReleaseObservation,
) {
  const commands = observation.interfaces[0]?.commands ?? [];
  return {
    product: observation.product,
    release: observation.release,
    verdict: {
      ...verdictView(observation.verdict),
      reasonCodes: observation.verdict.reasons.map((reason) => reason.code),
    },
    sources: observation.sources.map((source) => ({
      id: source.id,
      sourceId: source.sourceId,
      status: source.status,
      summary: source.summary,
      ...(source.sourceUrl ? { url: source.sourceUrl } : {}),
    })),
    artifacts: observation.artifacts.map((artifact) => ({
      id: artifact.id,
      status: artifact.status,
      summary: artifact.summary,
      format: artifact.format,
      ...(artifact.architecture ? { architecture: artifact.architecture } : {}),
      ...(artifact.sha256 ? { sha256: artifact.sha256 } : {}),
      ...(artifact.sizeBytes !== undefined
        ? { sizeBytes: artifact.sizeBytes }
        : {}),
      verification: artifact.verification.map((item) => ({
        id: item.id,
        status: item.status,
        summary: item.summary,
      })),
    })),
    behavior: observation.behavior.flatMap((evidence) =>
      evidence.results.map((result) => ({
        testId: result.testId,
        status: result.status,
        summary: result.summary,
        ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
      })),
    ),
    interface: observation.interfaces[0]
      ? {
          status: observation.interfaces[0].status,
          cliName: observation.interfaces[0].cliName,
          ...(observation.interfaces[0].reportedVersion
            ? { reportedVersion: observation.interfaces[0].reportedVersion }
            : {}),
          commandCount: commands.length,
          commands: commands.slice(0, 40).map((command) => command.name),
        }
      : undefined,
    community: observation.community
      ? {
          status: observation.community.status,
          summary: observation.community.summary,
          issueCount: observation.community.issues.length,
          strongClusters: observation.community.clusters
            .filter((cluster) => cluster.strength === "strong")
            .map((cluster) => cluster.signature),
        }
      : undefined,
    ...(observation.comparedWith
      ? { comparedWith: observation.comparedWith }
      : {}),
    url: client.releasePageUrl(
      observation.product.id,
      observation.observationId,
    ),
  };
}

function incidentView(client: ReleaseLensClient, incident: Incident) {
  return {
    id: incident.id,
    productId: incident.productId,
    status: incident.status,
    openedAt: incident.openedAt,
    ...(incident.resolvedAt ? { resolvedAt: incident.resolvedAt } : {}),
    firstAffectedVersion: incident.firstAffectedVersion,
    ...(incident.resolvedByVersion
      ? { resolvedByVersion: incident.resolvedByVersion }
      : {}),
    affectedObservations: incident.affectedObservations,
    signatures: incident.regressionSignatures.map(
      (signature) => signature.summary,
    ),
    url: client.incidentPageUrl(incident.id),
  };
}

export type ReleaseLensServerOptions = {
  client: ReleaseLensClient;
  version?: string;
};

/** Builds the MCP server; the transport is chosen by the caller so tests can run it in memory. */
export function createReleaseLensServer(
  options: ReleaseLensServerOptions,
): McpServer {
  const { client } = options;
  const server = new McpServer(
    { name: "releaselens", version: options.version ?? "1.0.0" },
    { instructions },
  );

  server.registerTool(
    "list_products",
    {
      title: "List observed products",
      description:
        "Lists every developer tool this ReleaseLens site observes, with the current Latest release per channel, its verdict, and the Last Known Good per channel.",
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () =>
      guarded(async () => {
        const index = await client.index();
        return {
          site: client.siteUrl(),
          generatedAt: index.generatedAt,
          products: index.products.map((product) => ({
            id: product.id,
            name: product.name,
            releaseCount: product.releaseCount,
            latest: product.latest.map((pointer) =>
              latestView(client, pointer),
            ),
            knownGood: product.knownGood.map((pointer) =>
              knownGoodView(client, pointer),
            ),
          })),
          activeIncidents: index.incidents.filter(
            (incident) => incident.status !== "resolved",
          ).length,
          caveat: SCOPE_CAVEAT,
        };
      }),
  );

  server.registerTool(
    "get_release_status",
    {
      title: "Get current release status",
      description:
        "Returns the current Latest release and the Last Known Good for a product, per channel, with the deterministic verdict and its reasons. Use the product id from list_products (for example codex-cli or claude-code).",
      inputSchema: {
        product: z.string().min(1).describe("Product id, e.g. claude-code"),
        channel: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Optional channel such as stable, latest, preview, nightly, or alpha; all channels when omitted",
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ product, channel }) =>
      guarded(async () => {
        const document = await client.product(product);
        const channels = channel ? [channel] : document.channels;
        const unknown = channels.filter(
          (candidate) => !document.channels.includes(candidate),
        );
        if (unknown.length > 0) {
          throw new Error(
            `${document.product.name} does not track the ${unknown.join(", ")} channel. Tracked channels: ${document.channels.join(", ")}.`,
          );
        }
        return {
          product: document.product,
          channels: channels.map((entry) =>
            channelStatus(client, document, entry),
          ),
          caveat: SCOPE_CAVEAT,
        };
      }),
  );

  server.registerTool(
    "check_version",
    {
      title: "Check a specific version",
      description:
        "Reports whether a specific version of a product was observed, its verdict, whether it is the current Last Known Good, and what the current Latest and Last Known Good are. Useful before pinning or upgrading to that version.",
      inputSchema: {
        product: z.string().min(1).describe("Product id, e.g. codex-cli"),
        version: z
          .string()
          .min(1)
          .describe("Exact version string as the vendor publishes it"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ product, version }) =>
      guarded(async () => {
        const document = await client.product(product);
        const matches = document.releases.filter(
          (release) => release.canonicalVersion === version,
        );
        const context = document.channels.map((channel) =>
          channelStatus(client, document, channel),
        );
        if (matches.length === 0) {
          return {
            product: document.product,
            version,
            observed: false,
            message: `${document.product.name} ${version} has not been observed by this ReleaseLens site; it may be unreleased, withdrawn, older than the observation history, or published outside the tracked channels.`,
            channels: context,
            caveat: SCOPE_CAVEAT,
          };
        }
        return {
          product: document.product,
          version,
          observed: true,
          observations: matches.map((release) => ({
            channel: release.channel,
            ...(release.platform ? { platform: release.platform } : {}),
            observedAt: release.discoveredAt,
            verdict: verdictView(release.verdict),
            isLatest: document.latest.some(
              (pointer) => pointer.observationId === release.observationId,
            ),
            isLastKnownGood: document.knownGood.some(
              (pointer) => pointer.observationId === release.observationId,
            ),
            observationId: release.observationId,
            url: client.releasePageUrl(
              document.product.id,
              release.observationId,
            ),
          })),
          channels: context,
          caveat: SCOPE_CAVEAT,
        };
      }),
  );

  server.registerTool(
    "get_release_evidence",
    {
      title: "Get release evidence",
      description:
        "Returns the evidence behind one observed release: first-party sources, verified artifacts, interface snapshot, behavior checks, official-issue context, and the persisted material changes against the previous observation. Identify the release by observation id or by version (newest observation of that version).",
      inputSchema: {
        product: z.string().min(1).describe("Product id"),
        observationId: z
          .string()
          .min(1)
          .optional()
          .describe("Observation id from another tool result"),
        version: z
          .string()
          .min(1)
          .optional()
          .describe("Version string, used when no observation id is given"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ product, observationId, version }) =>
      guarded(async () => {
        const document = await client.product(product);
        const reference = observationId
          ? document.releases.find(
              (release) => release.observationId === observationId,
            )
          : version
            ? document.releases.find(
                (release) => release.canonicalVersion === version,
              )
            : undefined;
        if (!reference) {
          throw new Error(
            observationId || version
              ? `${document.product.name} has no observed release matching ${observationId ?? version}.`
              : "Provide either an observationId or a version.",
          );
        }
        const observation = await client.release(
          document.product.id,
          reference.observationId,
        );
        const diff = reference.diffId
          ? await client.diff(reference.diffId).catch(() => undefined)
          : undefined;
        return {
          ...observationDigest(client, observation),
          ...(diff
            ? {
                changesSincePrevious: {
                  comparedWith: diff.comparedWith,
                  materialChanges: diff.materialChanges.map(
                    (change) => change.summary,
                  ),
                  distributionChanges: diff.distributionChanges.map(
                    (change) => change.summary,
                  ),
                },
              }
            : {}),
          caveat: SCOPE_CAVEAT,
        };
      }),
  );

  server.registerTool(
    "list_incidents",
    {
      title: "List tracked incidents",
      description:
        "Lists regression incidents ReleaseLens tracks from reproducible behavior failures or strong official-issue clusters, optionally filtered by product and status (open, monitoring, resolved).",
      inputSchema: {
        product: z.string().min(1).optional().describe("Optional product id"),
        status: z
          .enum(["open", "monitoring", "resolved"])
          .optional()
          .describe("Optional incident status filter"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ product, status }) =>
      guarded(async () => {
        const incidents = await client.incidents(product);
        const selected = incidents.filter(
          (incident) => !status || incident.status === status,
        );
        return {
          ...(product ? { product } : {}),
          ...(status ? { status } : {}),
          count: selected.length,
          incidents: selected.map((incident) => incidentView(client, incident)),
        };
      }),
  );

  return server;
}
