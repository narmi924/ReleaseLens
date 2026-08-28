import { describe, expect, it } from "vitest";
import {
  ReleaseObservationSchema,
  type ReleaseObservation,
} from "@releaselens/core";
import { reconcileIncidents } from "./reconcile";

const stamp = "2026-08-28T12:00:00.000Z";

function observation(
  version: string,
  status: "NO_REGRESSION_DETECTED" | "SUSPECTED_REGRESSION",
  test: "pass" | "fail",
  at: string,
): ReleaseObservation {
  return ReleaseObservationSchema.parse({
    schemaVersion: 1,
    observationId: `codex-${version}`,
    product: { id: "codex", name: "Codex" },
    release: {
      canonicalVersion: version,
      sourceVersion: version,
      channel: "stable",
      discoveredAt: at,
    },
    sources: [
      {
        id: "source:fixture",
        kind: "source",
        sourceId: "fixture",
        sourceType: "fixture",
        status: "pass",
        summary: "fixture",
        observedAt: at,
      },
    ],
    artifacts: [
      {
        id: "artifact:fixture",
        kind: "artifact",
        status: "pass",
        summary: "fixture",
        observedAt: at,
        fileName: "fixture.msix",
        format: "msix",
        sourceHost: "example.invalid",
        verification: [],
      },
    ],
    behavior: [
      {
        id: "behavior:fixture",
        kind: "behavior",
        status: test,
        summary: "fixture",
        observedAt: at,
        results: [
          {
            testId: "codex-backend-version",
            status: test,
            startedAt: at,
            durationMs: 1,
            summary: "fixture",
          },
        ],
      },
    ],
    verdict: {
      status,
      severity: status === "SUSPECTED_REGRESSION" ? "major" : "info",
      reasons: [
        {
          code: "fixture",
          message: "fixture",
          evidenceRefs: ["behavior:fixture"],
        },
      ],
    },
  });
}

describe("incident reconciliation", () => {
  it("opens on a regression and resolves only after the failing signature clears", () => {
    const failed = observation("1.0.0", "SUSPECTED_REGRESSION", "fail", stamp);
    const open = reconcileIncidents([], [failed]);
    expect(open).toMatchObject([
      {
        id: "RL-CODEX-2026-08-28-01",
        status: "open",
        affectedObservations: [failed.observationId],
      },
    ]);

    const stillUnverified = ReleaseObservationSchema.parse({
      ...observation(
        "1.0.1",
        "NO_REGRESSION_DETECTED",
        "pass",
        "2026-08-28T13:00:00.000Z",
      ),
      verdict: {
        status: "UNVERIFIED",
        severity: "major",
        reasons: [{ code: "missing", message: "missing", evidenceRefs: [] }],
      },
    });
    const monitoring = reconcileIncidents(open, [stillUnverified]);
    expect(monitoring[0]).toMatchObject({ status: "monitoring" });

    const fixed = observation(
      "1.0.2",
      "NO_REGRESSION_DETECTED",
      "pass",
      "2026-08-28T14:00:00.000Z",
    );
    const resolved = reconcileIncidents(monitoring, [fixed]);
    expect(resolved[0]).toMatchObject({
      status: "resolved",
      resolvedByVersion: "1.0.2",
    });
    expect(resolved[0]?.events.map((event) => event.type)).toEqual([
      "opened",
      "monitoring",
      "resolved",
    ]);
  });

  it("retains a single incident when matching regression evidence persists", () => {
    const first = observation("1.0.0", "SUSPECTED_REGRESSION", "fail", stamp);
    const second = observation(
      "1.0.1",
      "SUSPECTED_REGRESSION",
      "fail",
      "2026-08-28T13:00:00.000Z",
    );
    const incidents = reconcileIncidents([], [first, second]);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.affectedObservations).toEqual([
      first.observationId,
      second.observationId,
    ]);
  });
});
