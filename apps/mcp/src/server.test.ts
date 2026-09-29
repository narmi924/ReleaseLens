import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ReleaseObservationSchema,
  type ReleaseObservation,
} from "@releaselens/core";
import { describe, expect, it } from "vitest";
import { ReleaseLensClient, type FetchLike } from "./client";
import { resolveBaseUrl } from "./index";
import { createReleaseLensServer, SCOPE_CAVEAT } from "./server";

const baseUrl = "https://releaselens.test/site";
const observedAt = "2026-09-28T16:07:04.820Z";

function observation(
  version: string,
  id: string,
  status: "NO_REGRESSION_DETECTED" | "UNVERIFIED",
): ReleaseObservation {
  return ReleaseObservationSchema.parse({
    schemaVersion: 1,
    observationId: id,
    product: { id: "codex-cli", name: "Codex CLI" },
    release: {
      canonicalVersion: version,
      sourceVersion: version,
      channel: "latest",
      platform: "windows-x64",
      discoveredAt: observedAt,
    },
    sources: [
      {
        id: "npm-registry:dist-tags",
        kind: "source",
        sourceId: "npm-registry",
        sourceType: "npm-registry",
        status: "pass",
        summary: "Observed 2 npm channel tags for @openai/codex.",
        sourceUrl: "https://registry.npmjs.org/%40openai%2Fcodex",
        observedAt,
      },
    ],
    artifacts: [
      {
        id: `artifact:npm:@openai/codex:${version}-win32-x64`,
        kind: "artifact",
        status: "pass",
        summary: "platform package passed integrity verification.",
        observedAt,
        fileName: `codex-${version}-win32-x64.tgz`,
        format: "npm-tgz",
        sourceHost: "registry.npmjs.org",
        sha256: "a".repeat(64),
        sizeBytes: 161_000_000,
        architecture: "x64",
        verification: [
          {
            id: "npm-integrity",
            kind: "verification",
            status: "pass",
            summary: "Verified npm sha512 Subresource Integrity.",
            observedAt,
          },
        ],
      },
    ],
    interfaces: [
      {
        id: "interface:codex",
        kind: "interface",
        status: "pass",
        summary: "fixture interface",
        observedAt,
        cliName: "codex",
        reportedVersion: version,
        commands: [
          { name: "exec", options: [], subcommands: [] },
          { name: "login", options: [], subcommands: [] },
        ],
        environmentKeys: [],
        configKeys: [],
      },
    ],
    behavior: [
      {
        id: "behavior:codex-cli",
        kind: "behavior",
        status: status === "UNVERIFIED" ? "fail" : "pass",
        summary: "fixture behavior",
        observedAt,
        results: [
          {
            testId: "codex-version",
            status: status === "UNVERIFIED" ? "fail" : "pass",
            startedAt: observedAt,
            durationMs: 12,
            exitCode: status === "UNVERIFIED" ? 1 : 0,
            summary: "codex-version completed.",
          },
        ],
      },
    ],
    verdict: {
      status,
      severity: status === "UNVERIFIED" ? "major" : "info",
      reasons: [
        {
          code:
            status === "UNVERIFIED"
              ? "REQUIRED_BEHAVIOR_NOT_PASSING"
              : "REQUIRED_SCOPE_PASSED",
          message:
            status === "UNVERIFIED"
              ? "Required behavior codex-version is fail."
              : "Required verification and declared behavior checks passed; this is not a safety guarantee.",
          evidenceRefs: [],
        },
      ],
    },
  });
}

const good = observation(
  "0.158.0",
  "codex-cli-latest-windows-x64-good",
  "NO_REGRESSION_DETECTED",
);
const bad = observation(
  "0.159.0",
  "codex-cli-latest-windows-x64-bad",
  "UNVERIFIED",
);

function pointer(entry: ReleaseObservation) {
  return {
    schemaVersion: 1,
    productId: entry.product.id,
    channel: entry.release.channel,
    platform: entry.release.platform,
    observationId: entry.observationId,
    version: entry.release.canonicalVersion,
    discoveredAt: entry.release.discoveredAt,
    verdict: entry.verdict,
  };
}

const knownGood = {
  schemaVersion: 1,
  productId: "codex-cli",
  channel: "latest",
  platform: "windows-x64",
  observationId: good.observationId,
  version: good.release.canonicalVersion,
  selectedAt: observedAt,
  requirementsSatisfied: ["source:pass", "codex-version:pass"],
};

const productDocument = {
  schemaVersion: 1,
  product: { id: "codex-cli", name: "Codex CLI" },
  channels: ["latest", "alpha"],
  latest: [pointer(bad)],
  knownGood: [knownGood],
  releases: [
    {
      observationId: bad.observationId,
      canonicalVersion: "0.159.0",
      channel: "latest",
      platform: "windows-x64",
      discoveredAt: observedAt,
      verdict: bad.verdict,
      comparedWith: good.observationId,
      diffId: `${bad.observationId}-from-${good.observationId}`,
    },
    {
      observationId: good.observationId,
      canonicalVersion: "0.158.0",
      channel: "latest",
      platform: "windows-x64",
      discoveredAt: observedAt,
      verdict: good.verdict,
    },
  ],
};

const incident = {
  schemaVersion: 1,
  id: "RL-CODEX-CLI-2026-09-28-01",
  productId: "codex-cli",
  status: "open",
  openedAt: observedAt,
  affectedObservations: [bad.observationId],
  firstAffectedVersion: "0.159.0",
  regressionSignatures: [
    {
      id: "behavior:codex-version",
      kind: "behavior",
      summary: "Behavior check codex-version failed: codex-version completed.",
      evidenceRefs: ["behavior:codex-cli"],
    },
  ],
  evidenceRefs: ["behavior:codex-cli"],
  events: [
    {
      at: observedAt,
      type: "opened",
      observationId: bad.observationId,
      summary: "Opened from UNVERIFIED evidence for 0.159.0.",
    },
  ],
};

const routes: Record<string, unknown> = {
  [`${baseUrl}/api/v1/index.json`]: {
    schemaVersion: 1,
    generatedAt: observedAt,
    products: [
      {
        id: "codex-cli",
        name: "Codex CLI",
        latest: [pointer(bad)],
        knownGood: [knownGood],
        releaseCount: 2,
      },
    ],
    incidents: [
      {
        id: incident.id,
        productId: "codex-cli",
        status: "open",
        openedAt: observedAt,
      },
    ],
  },
  [`${baseUrl}/api/v1/products/codex-cli/index.json`]: productDocument,
  [`${baseUrl}/api/v1/products/codex-cli/releases/${bad.observationId}.json`]:
    bad,
  [`${baseUrl}/api/v1/products/codex-cli/releases/${good.observationId}.json`]:
    good,
  [`${baseUrl}/api/v1/diffs/${bad.observationId}-from-${good.observationId}.json`]:
    {
      schemaVersion: 1,
      diffId: `${bad.observationId}-from-${good.observationId}`,
      productId: "codex-cli",
      observationId: bad.observationId,
      comparedWith: good.observationId,
      createdAt: observedAt,
      artifactChanges: [],
      interfaceChanges: [],
      behaviorChanges: [
        {
          type: "behavior-status-changed",
          summary: "Behavior codex-version: pass → fail.",
          before: "pass",
          after: "fail",
          material: true,
        },
      ],
      distributionChanges: [],
      materialChanges: [
        {
          type: "behavior-status-changed",
          summary: "Behavior codex-version: pass → fail.",
          before: "pass",
          after: "fail",
          material: true,
        },
      ],
    },
  [`${baseUrl}/api/v1/incidents.json`]: {
    schemaVersion: 1,
    incidents: [incident],
  },
  [`${baseUrl}/api/v1/products/codex-cli/incidents.json`]: {
    schemaVersion: 1,
    productId: "codex-cli",
    incidents: [incident],
  },
};

const fakeFetch: FetchLike = async (input) => {
  const body = routes[input];
  if (body === undefined) {
    return new Response("not found", { status: 404 });
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

async function connectedClient(): Promise<Client> {
  const server = createReleaseLensServer({
    client: new ReleaseLensClient({ baseUrl, fetch: fakeFetch }),
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "releaselens-test", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

async function callJson(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ payload: Record<string, unknown>; isError: boolean }> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text: string }>;
  const text = content[0]?.text ?? "";
  return {
    payload: result.isError
      ? { message: text }
      : (JSON.parse(text) as Record<string, unknown>),
    isError: result.isError === true,
  };
}

describe("ReleaseLens MCP server", () => {
  it("exposes read-only release intelligence tools", async () => {
    const client = await connectedClient();
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "check_version",
      "get_release_evidence",
      "get_release_status",
      "list_incidents",
      "list_products",
    ]);
    expect(tools.tools.every((tool) => tool.annotations?.readOnlyHint)).toBe(
      true,
    );
  });

  it("separates Latest from Last Known Good and always repeats the scope caveat", async () => {
    const client = await connectedClient();
    const products = await callJson(client, "list_products");
    expect(products.isError).toBe(false);
    expect(products.payload).toMatchObject({
      site: `${baseUrl}/`,
      activeIncidents: 1,
      caveat: SCOPE_CAVEAT,
    });
    const status = await callJson(client, "get_release_status", {
      product: "codex-cli",
      channel: "latest",
    });
    expect(status.payload).toMatchObject({
      channels: [
        {
          channel: "latest",
          latestIsKnownGood: false,
          latest: [{ version: "0.159.0", verdict: { status: "UNVERIFIED" } }],
          knownGood: [{ version: "0.158.0" }],
        },
      ],
    });
    const [channel] = status.payload.channels as Array<{ summary: string }>;
    expect(channel?.summary).toContain("Last Known Good is still 0.158.0");
  });

  it("answers version checks for observed and unobserved versions", async () => {
    const client = await connectedClient();
    const observed = await callJson(client, "check_version", {
      product: "codex-cli",
      version: "0.158.0",
    });
    expect(observed.payload).toMatchObject({
      observed: true,
      observations: [{ isLatest: false, isLastKnownGood: true }],
    });
    const unknown = await callJson(client, "check_version", {
      product: "codex-cli",
      version: "9.9.9",
    });
    expect(unknown.payload).toMatchObject({ observed: false });
    expect(String(unknown.payload.message)).toContain("has not been observed");
  });

  it("returns evidence digests with persisted material changes", async () => {
    const client = await connectedClient();
    const evidence = await callJson(client, "get_release_evidence", {
      product: "codex-cli",
      version: "0.159.0",
    });
    expect(evidence.isError).toBe(false);
    expect(evidence.payload).toMatchObject({
      release: { canonicalVersion: "0.159.0" },
      verdict: { status: "UNVERIFIED" },
      behavior: [{ testId: "codex-version", status: "fail", exitCode: 1 }],
      interface: {
        cliName: "codex",
        commandCount: 2,
        commands: ["exec", "login"],
      },
      changesSincePrevious: {
        comparedWith: good.observationId,
        materialChanges: ["Behavior codex-version: pass → fail."],
      },
    });
    const artifacts = evidence.payload.artifacts as Array<{ sha256: string }>;
    expect(artifacts[0]?.sha256).toBe("a".repeat(64));
  });

  it("lists incidents and reports unknown products as tool errors", async () => {
    const client = await connectedClient();
    const incidents = await callJson(client, "list_incidents", {
      product: "codex-cli",
      status: "open",
    });
    expect(incidents.payload).toMatchObject({
      count: 1,
      incidents: [
        {
          id: "RL-CODEX-CLI-2026-09-28-01",
          url: `${baseUrl}/incidents/RL-CODEX-CLI-2026-09-28-01/`,
        },
      ],
    });
    const missing = await callJson(client, "get_release_status", {
      product: "not-a-product",
    });
    expect(missing.isError).toBe(true);
    expect(String(missing.payload.message)).toContain("not published");
    const unsafe = await callJson(client, "get_release_status", {
      product: "../etc",
    });
    expect(unsafe.isError).toBe(true);
    expect(String(unsafe.payload.message)).toContain("may only contain");
  });

  it("only accepts https or local base URLs", () => {
    expect(resolveBaseUrl([], {})).toBe(
      "https://narmi924.github.io/ReleaseLens",
    );
    expect(resolveBaseUrl(["--base-url", "http://localhost:3100"], {})).toBe(
      "http://localhost:3100",
    );
    expect(
      resolveBaseUrl([], { RELEASELENS_BASE_URL: "https://example.test/rl" }),
    ).toBe("https://example.test/rl");
    expect(() =>
      resolveBaseUrl(["--base-url", "http://example.test"], {}),
    ).toThrow(/https/);
    expect(() => resolveBaseUrl(["--base-url", "nonsense"], {})).toThrow(
      /valid URL/,
    );
  });
});
