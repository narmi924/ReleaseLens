import {
  compareVersions,
  type BehaviorResult,
  type KnownGoodPointer,
  type ProductProfile,
  type ReleaseDiff,
  type ReleaseObservation,
  type ReleaseVerdict,
  type VerdictStatus,
  SCHEMA_VERSION,
} from "@releaselens/core";
import { detectCurrentDistributionDrift } from "../diff/release";

export type VerdictInput = {
  profile: ProductProfile;
  observation: Omit<ReleaseObservation, "verdict">;
  diff?: ReleaseDiff;
};

type RequirementCheck = {
  satisfied: boolean;
  reason?: { code: string; message: string; evidenceRefs: string[] };
};

function evidenceForKind(
  observation: Omit<ReleaseObservation, "verdict">,
  kind: string,
) {
  switch (kind) {
    case "source":
      return observation.sources;
    case "artifact":
      return observation.artifacts;
    case "interface":
      return observation.interfaces;
    case "behavior":
      return observation.behavior;
    case "community":
      return observation.community ? [observation.community] : [];
    default:
      return [];
  }
}

function requiredEvidenceCheck(
  profile: ProductProfile,
  observation: Omit<ReleaseObservation, "verdict">,
  options: { includeBehavior?: boolean } = {},
): RequirementCheck[] {
  return profile.knownGoodPolicy.requiredEvidenceKinds
    .filter((kind) => options.includeBehavior || kind !== "behavior")
    .map((kind) => {
      const evidence = evidenceForKind(observation, kind);
      const pass = evidence.some((item) => item.status === "pass");
      return pass
        ? { satisfied: true }
        : {
            satisfied: false,
            reason: {
              code: "REQUIRED_EVIDENCE_MISSING_OR_INVALID",
              message: `Required ${kind} evidence is missing or did not pass.`,
              evidenceRefs: evidence.map((item) => item.id),
            },
          };
    });
}

function requiredBehaviorResults(
  profile: ProductProfile,
  observation: Omit<ReleaseObservation, "verdict">,
): BehaviorResult[] {
  const all = observation.behavior.flatMap((evidence) => evidence.results);
  return profile.knownGoodPolicy.requiredBehaviorTests.map(
    (testId) =>
      all.find((result) => result.testId === testId) ?? {
        testId,
        status: "fail" as const,
        startedAt: observation.release.discoveredAt,
        durationMs: 0,
        summary: "Required behavior test has no result.",
      },
  );
}

function behaviorFailureReasons(
  profile: ProductProfile,
  observation: Omit<ReleaseObservation, "verdict">,
) {
  return requiredBehaviorResults(profile, observation)
    .filter((result) => result.status !== "pass")
    .map((result) => ({
      code: "REQUIRED_BEHAVIOR_NOT_PASSING",
      message: `Required behavior ${result.testId} is ${result.status}.`,
      evidenceRefs: observation.behavior
        .filter((evidence) =>
          evidence.results.some(
            (candidate) => candidate.testId === result.testId,
          ),
        )
        .map((evidence) => evidence.id),
    }));
}

function hasCriticalBehaviorRegression(
  profile: ProductProfile,
  diff: ReleaseDiff | undefined,
): boolean {
  if (!diff) {
    return false;
  }
  return diff.behaviorChanges.some(
    (change) =>
      change.type === "behavior-status-changed" &&
      change.before === "pass" &&
      change.after === "fail" &&
      profile.knownGoodPolicy.requiredBehaviorTests.some((testId) =>
        change.summary.includes(testId),
      ),
  );
}

function communitySignals(observation: Omit<ReleaseObservation, "verdict">): {
  strong: boolean;
  maintainer: boolean;
  refs: string[];
} {
  const community = observation.community;
  if (!community) {
    return { strong: false, maintainer: false, refs: [] };
  }
  const strong = community.clusters.some(
    (cluster) => cluster.strength === "strong",
  );
  const maintainer = community.issues.some(
    (issue) => issue.maintainerAcknowledged,
  );
  return {
    strong,
    maintainer,
    refs: [community.id, ...community.issues.map((issue) => issue.id)],
  };
}

function verdict(
  status: VerdictStatus,
  severity: ReleaseVerdict["severity"],
  code: string,
  message: string,
  evidenceRefs: string[],
): ReleaseVerdict {
  return { status, severity, reasons: [{ code, message, evidenceRefs }] };
}

export function evaluateVerdict(input: VerdictInput): ReleaseVerdict {
  // A failed smoke is evidence of a possible regression, not a missing artifact or
  // provenance record.  Keep it out of the foundational-evidence gate so the
  // documented regression precedence can be applied.  A *missing* behavior
  // evidence record still makes the release unverifiable below.
  const evidenceChecks = requiredEvidenceCheck(
    input.profile,
    input.observation,
  );
  const behaviorFailures = behaviorFailureReasons(
    input.profile,
    input.observation,
  );
  const hasBehaviorEvidence = input.observation.behavior.some(
    (evidence) => evidence.status !== "unsupported",
  );
  if (
    evidenceChecks.some((check) => !check.satisfied) ||
    !hasBehaviorEvidence ||
    behaviorFailures.some((reason) => reason.message.includes("no result"))
  ) {
    const reasons = [
      ...evidenceChecks.flatMap((check) =>
        check.reason ? [check.reason] : [],
      ),
      ...behaviorFailures,
    ];
    return {
      status: "UNVERIFIED",
      severity: "major",
      reasons:
        reasons.length > 0
          ? reasons
          : [
              {
                code: "INSUFFICIENT_EVIDENCE",
                message: "Evidence is insufficient.",
                evidenceRefs: [],
              },
            ],
    };
  }
  const regression = hasCriticalBehaviorRegression(input.profile, input.diff);
  const community = communitySignals(input.observation);
  if (regression && (community.strong || community.maintainer)) {
    return verdict(
      "CONFIRMED_REGRESSION",
      "critical",
      "REPRODUCIBLE_FAILURE_WITH_INDEPENDENT_EVIDENCE",
      "A required behavior regressed from pass to fail and independent official-GitHub evidence supports it.",
      community.refs,
    );
  }
  if (regression || community.strong) {
    return verdict(
      "SUSPECTED_REGRESSION",
      "major",
      regression
        ? "REPRODUCIBLE_CRITICAL_BEHAVIOR_FAILURE"
        : "STRONG_OFFICIAL_GITHUB_CLUSTER",
      regression
        ? "A required behavior regressed from pass to fail."
        : "A strong official-GitHub issue cluster is associated with this release.",
      community.refs,
    );
  }
  if (
    input.diff?.distributionChanges.some(
      (change) => change.type === "distribution-drift",
    ) ||
    detectCurrentDistributionDrift(input.observation as ReleaseObservation)
      .length > 0
  ) {
    return verdict(
      "DISTRIBUTION_DRIFT",
      "minor",
      "OFFICIAL_DISTRIBUTIONS_DISAGREE",
      "Relevant official distribution channels disagree.",
      [],
    );
  }
  if ((input.diff?.materialChanges.length ?? 0) > 0) {
    if (behaviorFailures.length > 0) {
      return {
        status: "UNVERIFIED",
        severity: "major",
        reasons: behaviorFailures,
      };
    }
    return verdict(
      "CHANGED",
      "minor",
      "MATERIAL_EVIDENCE_CHANGED",
      "Verified material artifact, interface, behavior, or distribution evidence changed.",
      [],
    );
  }
  if (behaviorFailures.length > 0) {
    return {
      status: "UNVERIFIED",
      severity: "major",
      reasons: behaviorFailures,
    };
  }
  return verdict(
    "NO_REGRESSION_DETECTED",
    "info",
    "REQUIRED_SCOPE_PASSED",
    "Required verification and declared behavior checks passed; this is not a safety guarantee.",
    [],
  );
}

export function knownGoodRequirements(
  profile: ProductProfile,
  observation: ReleaseObservation,
): string[] | undefined {
  if (
    !profile.knownGoodPolicy.acceptedVerdicts.includes(
      observation.verdict.status,
    )
  ) {
    return undefined;
  }
  if (observation.verdict.status === "CONFIRMED_REGRESSION") {
    return undefined;
  }
  const evidence = requiredEvidenceCheck(profile, observation);
  if (evidence.some((check) => !check.satisfied)) {
    return undefined;
  }
  const behavior = requiredBehaviorResults(profile, observation);
  if (behavior.some((result) => result.status !== "pass")) {
    return undefined;
  }
  return [
    ...profile.knownGoodPolicy.requiredEvidenceKinds.map(
      (kind) => `${kind}:pass`,
    ),
    ...profile.knownGoodPolicy.requiredBehaviorTests.map(
      (testId) => `${testId}:pass`,
    ),
  ];
}

export function selectLastKnownGood(
  profile: ProductProfile,
  observations: ReleaseObservation[],
  channel: string,
  platform?: string,
): KnownGoodPointer | undefined {
  const eligible = observations
    .filter(
      (observation) =>
        observation.product.id === profile.id &&
        observation.release.channel === channel,
    )
    .filter(
      (observation) =>
        platform === undefined || observation.release.platform === platform,
    )
    .map((observation) => ({
      observation,
      requirements: knownGoodRequirements(profile, observation),
    }))
    .filter(
      (
        candidate,
      ): candidate is {
        observation: ReleaseObservation;
        requirements: string[];
      } => candidate.requirements !== undefined,
    );
  if (eligible.length === 0) {
    return undefined;
  }
  eligible.sort((left, right) => {
    try {
      const comparison = compareVersions(
        left.observation.release.canonicalVersion,
        right.observation.release.canonicalVersion,
        profile.releaseModel.versionScheme,
      );
      if (comparison !== 0) {
        return -comparison;
      }
    } catch {
      // Stable timestamp order is a safe fallback for an opaque malformed upstream version.
    }
    return right.observation.release.discoveredAt.localeCompare(
      left.observation.release.discoveredAt,
    );
  });
  const selected = eligible[0]!;
  return {
    schemaVersion: SCHEMA_VERSION,
    productId: profile.id,
    channel,
    ...(platform ? { platform } : {}),
    observationId: selected.observation.observationId,
    version: selected.observation.release.canonicalVersion,
    selectedAt: selected.observation.release.discoveredAt,
    requirementsSatisfied: selected.requirements,
  };
}
