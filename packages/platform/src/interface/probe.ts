import type { BehaviorResult, InterfaceEvidence } from "@releaselens/core";
import { interfaceEvidenceFromSnapshot, normalizeCliHelp } from "./normalize";
import { runBoundedProcess } from "./process";

export type CliProbePlan = {
  cliName: string;
  executable: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  versionArgs?: string[];
  helpArgs?: string[];
};

export type CliInterfaceProbe = {
  interface?: InterfaceEvidence;
  results: BehaviorResult[];
};

type ProbeExecution = Awaited<ReturnType<typeof runBoundedProcess>>;

function result(
  testId: string,
  startedAt: string,
  probe: ProbeExecution,
  attempts: number,
): BehaviorResult {
  const successful = !probe.timedOut && probe.exitCode === 0;
  return {
    testId,
    status: successful ? "pass" : "fail",
    startedAt,
    durationMs: probe.durationMs,
    ...(probe.exitCode !== undefined ? { exitCode: probe.exitCode } : {}),
    summary: successful
      ? `${testId} completed.`
      : `${testId} failed or timed out.`,
    structuredDetails: { timedOut: probe.timedOut, attempts },
  };
}

async function runProbeWithOneRetry(
  request: Parameters<typeof runBoundedProcess>[0],
): Promise<{ probe: ProbeExecution; attempts: number }> {
  const first = await runBoundedProcess(request);
  if (!first.timedOut && first.exitCode === 0) {
    return { probe: first, attempts: 1 };
  }
  return { probe: await runBoundedProcess(request), attempts: 2 };
}

export async function probeCliInterface(
  plan: CliProbePlan,
  observedAt: string,
): Promise<CliInterfaceProbe> {
  const [versionExecution, helpExecution] = await Promise.all([
    runProbeWithOneRetry({
      executable: plan.executable,
      args: plan.versionArgs ?? ["--version"],
      ...(plan.cwd ? { cwd: plan.cwd } : {}),
      ...(plan.env ? { env: plan.env } : {}),
    }),
    runProbeWithOneRetry({
      executable: plan.executable,
      args: plan.helpArgs ?? ["--help"],
      ...(plan.cwd ? { cwd: plan.cwd } : {}),
      ...(plan.env ? { env: plan.env } : {}),
    }),
  ]);
  const versionProbe = versionExecution.probe;
  const helpProbe = helpExecution.probe;
  const results = [
    result(
      `${plan.cliName}-version`,
      observedAt,
      versionProbe,
      versionExecution.attempts,
    ),
    result(
      `${plan.cliName}-help`,
      observedAt,
      helpProbe,
      helpExecution.attempts,
    ),
  ];
  if (helpProbe.timedOut || helpProbe.exitCode !== 0) {
    return { results };
  }
  const snapshot = normalizeCliHelp(
    plan.cliName,
    helpProbe.stdout,
    versionProbe.stdout,
  );
  return {
    interface: interfaceEvidenceFromSnapshot(
      snapshot,
      observedAt,
      versionProbe.exitCode === 0 ? "pass" : "warning",
    ),
    results,
  };
}

export const productCliProbePlans = {
  codex: (
    executable: string,
    environment: NodeJS.ProcessEnv,
  ): CliProbePlan => ({ cliName: "codex", executable, env: environment }),
  "claude-code": (
    executable: string,
    environment: NodeJS.ProcessEnv,
  ): CliProbePlan => ({ cliName: "claude", executable, env: environment }),
  "gemini-cli": (
    executable: string,
    environment: NodeJS.ProcessEnv,
  ): CliProbePlan => ({ cliName: "gemini", executable, env: environment }),
};
