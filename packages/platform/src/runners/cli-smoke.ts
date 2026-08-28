import type {
  BehaviorEvidence,
  BehaviorResult,
  InterfaceEvidence,
} from "@releaselens/core";
import { probeCliInterface } from "../interface/probe";
import {
  runBoundedProcess,
  withIsolatedProcessEnvironment,
} from "../interface/process";
import { behaviorEvidence } from "./framework";
import { requireExecutionPermit, type ExecutionPermit } from "./permit";

export type CliSmokeOutcome = {
  behavior: BehaviorEvidence;
  interface?: InterfaceEvidence;
  results: BehaviorResult[];
};

export type VerifiedCliSmokePlan = {
  permit: ExecutionPermit;
  productId: string;
  cliName: string;
  executable: string;
  versionArgs?: string[];
  helpArgs?: string[];
  doctorArgs?: string[];
  doctorOptional?: boolean;
  observedAt: string;
};

function doctorResult(
  testId: string,
  observedAt: string,
  result: Awaited<ReturnType<typeof runBoundedProcess>>,
  optional: boolean,
): BehaviorResult {
  const passed = result.exitCode === 0 && !result.timedOut;
  return {
    testId,
    status: passed ? "pass" : optional ? "warning" : "fail",
    startedAt: observedAt,
    durationMs: result.durationMs,
    ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
    summary: passed
      ? `${testId} completed.`
      : `${testId} did not complete successfully.`,
    structuredDetails: { timedOut: result.timedOut },
  };
}

export async function runVerifiedCliSmoke(
  plan: VerifiedCliSmokePlan,
): Promise<CliSmokeOutcome> {
  requireExecutionPermit(plan.permit);
  return withIsolatedProcessEnvironment(
    `releaselens-${plan.productId}`,
    async (isolated) => {
      const probe = await probeCliInterface(
        {
          cliName: plan.cliName,
          executable: plan.executable,
          env: isolated.environment,
          ...(plan.versionArgs ? { versionArgs: plan.versionArgs } : {}),
          ...(plan.helpArgs ? { helpArgs: plan.helpArgs } : {}),
        },
        plan.observedAt,
      );
      const results = [...probe.results];
      if (plan.doctorArgs) {
        const first = await runBoundedProcess({
          executable: plan.executable,
          args: plan.doctorArgs,
          env: isolated.environment,
        });
        const second =
          first.exitCode === 0 && !first.timedOut
            ? undefined
            : await runBoundedProcess({
                executable: plan.executable,
                args: plan.doctorArgs,
                env: isolated.environment,
              });
        const final = second ?? first;
        const result = doctorResult(
          `${plan.cliName}-diagnostics`,
          plan.observedAt,
          final,
          plan.doctorOptional ?? true,
        );
        results.push({
          ...result,
          structuredDetails: {
            ...(result.structuredDetails ?? {}),
            attempts: second ? 2 : 1,
          },
        });
      }
      return {
        behavior: behaviorEvidence(plan.productId, results, plan.observedAt),
        ...(probe.interface ? { interface: probe.interface } : {}),
        results,
      };
    },
  );
}
