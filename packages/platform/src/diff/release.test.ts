import { describe, expect, it } from "vitest";
import { ReleaseObservationSchema } from "@releaselens/core";
import { buildReleaseDiff, diffArtifacts } from "./release";

const timestamp = "2026-08-28T00:00:00.000Z";

function release(version: string, hash: string, status: "pass" | "fail") {
  return ReleaseObservationSchema.parse({
    schemaVersion: 1,
    observationId: `fixture-${version}`,
    product: { id: "fixture", name: "Fixture" },
    release: {
      canonicalVersion: version,
      sourceVersion: version,
      channel: "stable",
      discoveredAt: timestamp,
    },
    sources: [
      {
        id: "source:fixture",
        kind: "source",
        sourceId: "fixture-source",
        sourceType: "fixture",
        status: "pass",
        summary: "fixture",
        observedAt: timestamp,
        details: { version },
      },
    ],
    artifacts: [
      {
        id: "artifact:fixture",
        kind: "artifact",
        status: "pass",
        summary: "fixture",
        observedAt: timestamp,
        fileName: "fixture.bin",
        format: "bin",
        sourceHost: "example.invalid",
        sizeBytes: version === "1.0.0" ? 100 : 130,
        sha256: hash,
        verification: [],
        details: {
          topLevelDirectories: version === "1.0.0" ? ["old"] : ["new"],
        },
      },
    ],
    interfaces: [
      {
        id: "interface:fixture",
        kind: "interface",
        status: "pass",
        summary: "fixture",
        observedAt: timestamp,
        cliName: "fixture",
        commands: [
          {
            name: version === "1.0.0" ? "run" : "inspect",
            options: [],
            subcommands: [],
          },
        ],
        environmentKeys: [],
        configKeys: [],
        details: {
          globalOptions: [{ names: [version === "1.0.0" ? "--old" : "--new"] }],
        },
      },
    ],
    behavior: [
      {
        id: "behavior:fixture",
        kind: "behavior",
        status,
        summary: "fixture",
        observedAt: timestamp,
        results: [
          {
            testId: "fixture-version",
            status,
            startedAt: timestamp,
            durationMs: 1,
            summary: "fixture",
          },
        ],
      },
    ],
    verdict: {
      status: "NO_REGRESSION_DETECTED",
      severity: "info",
      reasons: [{ code: "fixture", message: "fixture", evidenceRefs: [] }],
    },
  });
}

describe("release diff", () => {
  it("persists artifact, interface, behavior, and distribution changes", () => {
    const before = release("1.0.0", "a".repeat(64), "pass");
    const after = release("1.1.0", "b".repeat(64), "fail");
    const diff = buildReleaseDiff(before, after)!;
    expect(
      diffArtifacts(before.artifacts, after.artifacts).map(
        (change) => change.type,
      ),
    ).toContain("artifact-sha256-changed");
    expect(diff.interfaceChanges.map((change) => change.type)).toContain(
      "command-added",
    );
    expect(diff.behaviorChanges).toMatchObject([
      { type: "behavior-status-changed", before: "pass", after: "fail" },
    ]);
    expect(diff.distributionChanges.map((change) => change.type)).toContain(
      "distribution-version-changed",
    );
    expect(diff.materialChanges.length).toBeGreaterThan(0);
  });
});
