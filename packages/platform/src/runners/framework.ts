import type {
  BehaviorEvidence,
  BehaviorResult,
  EvidenceStatus,
} from "@releaselens/core";
import type { RunnerCapabilities, RunnerCapability } from "./capabilities";
import { unsupportedForCapabilities } from "./capabilities";

export type BehaviorAttempt = () => Promise<BehaviorResult>;

export async function runWithOneControlledRetry(
  testId: string,
  requiredCapabilities: RunnerCapability[],
  capabilities: RunnerCapabilities,
  attempt: BehaviorAttempt,
  retryCriticalFailure = true,
  startedAt = new Date().toISOString(),
): Promise<BehaviorResult> {
  const unsupported = unsupportedForCapabilities(
    testId,
    requiredCapabilities,
    capabilities,
    startedAt,
  );
  if (unsupported) {
    return unsupported;
  }
  const first = await attempt();
  if (!retryCriticalFailure || first.status !== "fail") {
    return first;
  }
  const second = await attempt();
  return {
    ...second,
    structuredDetails: {
      ...(second.structuredDetails ?? {}),
      controlledRetry: {
        firstStatus: first.status,
        firstExitCode: first.exitCode,
        secondStatus: second.status,
        secondExitCode: second.exitCode,
      },
    },
  };
}

function evidenceStatus(results: BehaviorResult[]): EvidenceStatus {
  if (results.some((result) => result.status === "fail")) {
    return "fail";
  }
  if (results.some((result) => result.status === "warning")) {
    return "warning";
  }
  if (
    results.every(
      (result) =>
        result.status === "unsupported" || result.status === "not-applicable",
    )
  ) {
    return "unsupported";
  }
  return "pass";
}

export function behaviorEvidence(
  productId: string,
  results: BehaviorResult[],
  observedAt: string,
): BehaviorEvidence {
  return {
    id: `behavior:${productId}:${observedAt}`,
    kind: "behavior",
    status: evidenceStatus(results),
    summary: `${productId} behavior suite produced ${results.filter((result) => result.status === "pass").length} passing result(s).`,
    observedAt,
    results,
  };
}
