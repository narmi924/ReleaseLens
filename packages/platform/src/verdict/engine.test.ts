import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadProductProfiles,
  ReleaseObservationSchema,
  type ReleaseObservation,
} from "@releaselens/core";
import { buildReleaseDiff } from "../diff/release";
import { evaluateVerdict, selectLastKnownGood } from "./engine";

const timestamp = "2026-08-28T00:00:00.000Z";
const sha = "a".repeat(64);

function observation(
  productId: "gemini-cli" | "claude-code",
  version: string,
  options: {
    versionStatus?: "pass" | "fail";
    nativeVersion?: string;
    wingetVersion?: string;
    communityStrong?: boolean;
    verdict?: ReleaseObservation["verdict"];
  } = {},
): ReleaseObservation {
  const requiredVersionTest =
    productId === "gemini-cli" ? "gemini-version" : "claude-version";
  const helpTest = productId === "gemini-cli" ? "gemini-help" : "claude-help";
  const versionStatus = options.versionStatus ?? "pass";
  const sourceDetails =
    productId === "claude-code"
      ? [
          {
            sourceId: "claude-native",
            version: options.nativeVersion ?? version,
          },
          { sourceId: "winget", version: options.wingetVersion ?? version },
        ]
      : [
          {
            sourceId: "npm-registry",
            channels: [{ channel: "latest", version }],
          },
        ];
  return ReleaseObservationSchema.parse({
    schemaVersion: 1,
    observationId: `${productId}-${version}-${options.versionStatus ?? "pass"}`,
    product: { id: productId, name: productId },
    release: {
      canonicalVersion: version,
      sourceVersion: version,
      channel: "stable",
      discoveredAt: timestamp,
    },
    sources: sourceDetails.map((source) => ({
      id: `source:${source.sourceId}`,
      kind: "source",
      sourceId: source.sourceId,
      sourceType: "fixture",
      status: "pass",
      summary: "fixture source",
      observedAt: timestamp,
      details: source,
    })),
    artifacts:
      productId === "gemini-cli"
        ? [
            {
              id: "artifact:fixture",
              kind: "artifact",
              status: "pass",
              summary: "fixture artifact",
              observedAt: timestamp,
              fileName: "fixture.tgz",
              format: "npm-tgz",
              sourceHost: "registry.npmjs.org",
              sha256: sha,
              packageIdentity: "@fixture/gemini",
              packageVersion: version,
              verification: [],
            },
          ]
        : [],
    interfaces: [
      {
        id: "interface:fixture",
        kind: "interface",
        status: "pass",
        summary: "fixture interface",
        observedAt: timestamp,
        cliName: productId === "gemini-cli" ? "gemini" : "claude",
        reportedVersion: version,
        commands: [{ name: "run", options: [], subcommands: [] }],
        environmentKeys: [],
        configKeys: [],
        details: { globalOptions: [{ names: ["--json"] }] },
      },
    ],
    behavior: [
      {
        id: "behavior:fixture",
        kind: "behavior",
        status: versionStatus === "pass" ? "pass" : "fail",
        summary: "fixture behavior",
        observedAt: timestamp,
        results: [
          {
            testId: requiredVersionTest,
            status: versionStatus,
            startedAt: timestamp,
            durationMs: 1,
            summary: "fixture",
          },
          {
            testId: helpTest,
            status: "pass",
            startedAt: timestamp,
            durationMs: 1,
            summary: "fixture",
          },
        ],
      },
    ],
    ...(options.communityStrong
      ? {
          community: {
            id: "community:fixture",
            kind: "community",
            status: "warning",
            summary: "strong fixture cluster",
            observedAt: timestamp,
            repository: "fixture/repository",
            issues: [
              {
                id: "issue:1",
                url: "https://github.com/fixture/repository/issues/1",
                title: "fixture regression",
                createdAt: timestamp,
                labels: [],
                maintainerAcknowledged: false,
              },
            ],
            clusters: [
              {
                signature: "fixture-error",
                issueIds: ["issue:1"],
                strength: "strong",
              },
            ],
          },
        }
      : {}),
    verdict: options.verdict ?? {
      status: "NO_REGRESSION_DETECTED",
      severity: "info",
      reasons: [{ code: "fixture", message: "fixture", evidenceRefs: [] }],
    },
  });
}

function withoutVerdict(value: ReleaseObservation) {
  const draft: Partial<ReleaseObservation> = { ...value };
  delete draft.verdict;
  return draft as Omit<ReleaseObservation, "verdict">;
}

describe("deterministic verdict and Last Known Good", () => {
  it("classifies verified unchanged evidence as no regression detected", async () => {
    const profile = (
      await loadProductProfiles(resolve(process.cwd(), "products"))
    ).find((candidate) => candidate.id === "gemini-cli")!;
    expect(
      evaluateVerdict({
        profile,
        observation: withoutVerdict(observation("gemini-cli", "1.2.3")),
      }).status,
    ).toBe("NO_REGRESSION_DETECTED");
  });

  it("prioritizes distribution drift and reproducible community-supported regressions", async () => {
    const profiles = await loadProductProfiles(
      resolve(process.cwd(), "products"),
    );
    const claude = profiles.find((profile) => profile.id === "claude-code")!;
    const beforeClaude = observation("claude-code", "2.0.0");
    const afterClaude = observation("claude-code", "2.1.0", {
      nativeVersion: "2.1.0",
      wingetVersion: "2.0.0",
    });
    const drift = buildReleaseDiff(beforeClaude, afterClaude)!;
    expect(
      evaluateVerdict({
        profile: claude,
        observation: withoutVerdict(afterClaude),
        diff: drift,
      }).status,
    ).toBe("DISTRIBUTION_DRIFT");
    expect(
      evaluateVerdict({
        profile: claude,
        observation: withoutVerdict(afterClaude),
      }).status,
    ).toBe("DISTRIBUTION_DRIFT");

    const gemini = profiles.find((profile) => profile.id === "gemini-cli")!;
    const beforeGemini = observation("gemini-cli", "1.2.3");
    const failedGemini = observation("gemini-cli", "1.2.4", {
      versionStatus: "fail",
      communityStrong: true,
    });
    const regression = buildReleaseDiff(beforeGemini, failedGemini)!;
    expect(
      evaluateVerdict({
        profile: gemini,
        observation: withoutVerdict(failedGemini),
        diff: regression,
      }).status,
    ).toBe("CONFIRMED_REGRESSION");
  });

  it("keeps Last Known Good separate from the latest regression verdict", async () => {
    const profile = (
      await loadProductProfiles(resolve(process.cwd(), "products"))
    ).find((candidate) => candidate.id === "gemini-cli")!;
    const good = observation("gemini-cli", "1.2.3");
    const bad = observation("gemini-cli", "1.2.4", {
      verdict: {
        status: "CONFIRMED_REGRESSION",
        severity: "critical",
        reasons: [{ code: "fixture", message: "fixture", evidenceRefs: [] }],
      },
    });
    const pointer = selectLastKnownGood(profile, [good, bad], "stable");
    expect(pointer).toMatchObject({
      version: "1.2.3",
      observationId: good.observationId,
    });
  });
});
