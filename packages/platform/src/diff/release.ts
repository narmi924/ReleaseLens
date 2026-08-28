import {
  type ArtifactEvidence,
  type BehaviorResult,
  type Change,
  type InterfaceEvidence,
  type ReleaseDiff,
  type ReleaseObservation,
  SCHEMA_VERSION,
} from "@releaselens/core";
import { diffInterfaceEvidence } from "../interface/diff";

function artifactKey(artifact: ArtifactEvidence): string {
  return `${artifact.format}:${artifact.packageIdentity ?? "unknown"}:${artifact.architecture ?? "unknown"}`;
}

function detailsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function setChanges(
  type: string,
  label: string,
  previous: string[],
  current: string[],
): Change[] {
  const prior = new Set(previous);
  const next = new Set(current);
  return [
    ...Array.from(next)
      .filter((value) => !prior.has(value))
      .sort((left, right) => left.localeCompare(right))
      .map((value) => ({
        type: `${type}-added`,
        summary: `${label} added: ${value}.`,
        after: value,
        material: true,
      })),
    ...Array.from(prior)
      .filter((value) => !next.has(value))
      .sort((left, right) => left.localeCompare(right))
      .map((value) => ({
        type: `${type}-removed`,
        summary: `${label} removed: ${value}.`,
        before: value,
        material: true,
      })),
  ];
}

export function diffArtifacts(
  previous: ArtifactEvidence[],
  current: ArtifactEvidence[],
): Change[] {
  const prior = new Map(
    previous.map((artifact) => [artifactKey(artifact), artifact]),
  );
  const next = new Map(
    current.map((artifact) => [artifactKey(artifact), artifact]),
  );
  const changes: Change[] = [];
  for (const key of new Set([...prior.keys(), ...next.keys()])) {
    const before = prior.get(key);
    const after = next.get(key);
    if (!before && after) {
      changes.push({
        type: "artifact-added",
        summary: `Artifact added: ${key}.`,
        after: { sha256: after.sha256, sizeBytes: after.sizeBytes },
        material: true,
      });
      continue;
    }
    if (before && !after) {
      changes.push({
        type: "artifact-removed",
        summary: `Artifact removed: ${key}.`,
        before: { sha256: before.sha256, sizeBytes: before.sizeBytes },
        material: true,
      });
      continue;
    }
    if (!before || !after) {
      continue;
    }
    if (before.sha256 && after.sha256 && before.sha256 !== after.sha256) {
      changes.push({
        type: "artifact-sha256-changed",
        summary: `Artifact bytes changed for ${key}.`,
        before: before.sha256,
        after: after.sha256,
        material: true,
      });
    }
    if (
      before.sizeBytes !== undefined &&
      after.sizeBytes !== undefined &&
      before.sizeBytes !== after.sizeBytes
    ) {
      const ratio =
        before.sizeBytes === 0
          ? undefined
          : (after.sizeBytes - before.sizeBytes) / before.sizeBytes;
      changes.push({
        type: "artifact-size-changed",
        summary: `Artifact size changed for ${key}.`,
        before: before.sizeBytes,
        after: after.sizeBytes,
        material: ratio === undefined || Math.abs(ratio) >= 0.01,
      });
    }
    const beforeDetails = detailsRecord(before.details);
    const afterDetails = detailsRecord(after.details);
    changes.push(
      ...setChanges(
        "artifact-file",
        "Artifact file",
        stringArray(beforeDetails.topLevelDirectories),
        stringArray(afterDetails.topLevelDirectories),
      ),
      ...setChanges(
        "dependency",
        "Dependency",
        stringArray(beforeDetails.dependencies),
        stringArray(afterDetails.dependencies),
      ),
    );
  }
  return changes;
}

function firstInterface(
  observation: ReleaseObservation,
): InterfaceEvidence | undefined {
  return observation.interfaces[0];
}

function behaviorMap(
  observation: ReleaseObservation,
): Map<string, BehaviorResult> {
  return new Map(
    observation.behavior
      .flatMap((evidence) => evidence.results)
      .map((result) => [result.testId, result]),
  );
}

export function diffBehavior(
  previous: ReleaseObservation,
  current: ReleaseObservation,
): Change[] {
  const prior = behaviorMap(previous);
  const next = behaviorMap(current);
  const changes: Change[] = [];
  for (const testId of new Set([...prior.keys(), ...next.keys()])) {
    const before = prior.get(testId);
    const after = next.get(testId);
    if (!before && after) {
      changes.push({
        type: "behavior-test-added",
        summary: `Behavior test added: ${testId}.`,
        after: after.status,
        material: false,
      });
    } else if (before && !after) {
      changes.push({
        type: "behavior-test-removed",
        summary: `Behavior test removed: ${testId}.`,
        before: before.status,
        material: true,
      });
    } else if (before && after && before.status !== after.status) {
      changes.push({
        type: "behavior-status-changed",
        summary: `Behavior ${testId}: ${before.status} → ${after.status}.`,
        before: before.status,
        after: after.status,
        material: before.status === "pass" || after.status === "fail",
      });
    }
  }
  return changes;
}

function distributionState(
  observation: ReleaseObservation,
): Map<string, string> {
  const state = new Map<string, string>();
  for (const source of observation.sources) {
    const details = detailsRecord(source.details);
    if (typeof details.version === "string") {
      state.set(source.sourceId, details.version);
    }
    if (typeof details.buildVersion === "string") {
      state.set(`${source.sourceId}:build`, details.buildVersion);
    }
    if (Array.isArray(details.channels)) {
      for (const channel of details.channels) {
        const entry = detailsRecord(channel);
        if (
          typeof entry.channel === "string" &&
          typeof entry.version === "string"
        ) {
          state.set(`${source.sourceId}:${entry.channel}`, entry.version);
        }
      }
    }
  }
  return state;
}

function currentDistributionDrift(state: Map<string, string>): Change[] {
  const native = state.get("claude-native");
  const winget = state.get("winget");
  if (native && winget && native !== winget) {
    return [
      {
        type: "distribution-drift",
        summary: `Claude Code native ${native} and WinGet ${winget} disagree.`,
        before: { native, winget },
        after: { native, winget },
        material: true,
      },
    ];
  }
  return [];
}

/** Detects a present-tense disagreement even when this is the first observation. */
export function detectCurrentDistributionDrift(
  observation: ReleaseObservation,
): Change[] {
  return currentDistributionDrift(distributionState(observation));
}

export function diffDistribution(
  previous: ReleaseObservation | undefined,
  current: ReleaseObservation,
): Change[] {
  const prior = previous
    ? distributionState(previous)
    : new Map<string, string>();
  const next = distributionState(current);
  const changes: Change[] = [];
  for (const key of new Set([...prior.keys(), ...next.keys()])) {
    const before = prior.get(key);
    const after = next.get(key);
    if (before !== after && after !== undefined) {
      changes.push({
        type: "distribution-version-changed",
        summary: `Distribution state ${key}: ${before ?? "unobserved"} → ${after}.`,
        ...(before ? { before } : {}),
        after,
        material: true,
      });
    }
  }
  return [...changes, ...currentDistributionDrift(next)];
}

export function buildReleaseDiff(
  previous: ReleaseObservation | undefined,
  current: ReleaseObservation,
  createdAt = current.release.discoveredAt,
): ReleaseDiff | undefined {
  if (!previous) {
    return undefined;
  }
  const artifactChanges = diffArtifacts(previous.artifacts, current.artifacts);
  const interfaceChanges = diffInterfaceEvidence(
    firstInterface(previous),
    firstInterface(current) ?? {
      id: "interface:missing",
      kind: "interface",
      status: "warning",
      summary: "No current interface snapshot.",
      observedAt: current.release.discoveredAt,
      cliName: "unknown",
      commands: [],
      environmentKeys: [],
      configKeys: [],
    },
  );
  const behaviorChanges = diffBehavior(previous, current);
  const distributionChanges = diffDistribution(previous, current);
  const materialChanges = [
    ...artifactChanges,
    ...interfaceChanges,
    ...behaviorChanges,
    ...distributionChanges,
  ].filter((change) => change.material);
  return {
    schemaVersion: SCHEMA_VERSION,
    diffId: `${current.observationId}-from-${previous.observationId}`,
    productId: current.product.id,
    observationId: current.observationId,
    comparedWith: previous.observationId,
    createdAt,
    artifactChanges,
    interfaceChanges,
    behaviorChanges,
    distributionChanges,
    materialChanges,
  };
}
