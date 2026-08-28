import type { BehaviorResult } from "@releaselens/core";

export type RunnerCapability =
  | "windows"
  | "shell"
  | "network"
  | "node"
  | "interactiveGui"
  | "adminPackageInstall";

export type RunnerCapabilities = Record<RunnerCapability, boolean> & {
  platform: NodeJS.Platform;
  architecture: string;
};

export function detectRunnerCapabilities(
  environment: NodeJS.ProcessEnv = process.env,
): RunnerCapabilities {
  const windows = process.platform === "win32";
  return {
    platform: process.platform,
    architecture: process.arch,
    windows,
    shell: true,
    network: environment.RELEASELENS_DISABLE_NETWORK !== "1",
    node: Boolean(process.execPath),
    interactiveGui:
      windows && environment.RELEASELENS_ENABLE_DESKTOP_STARTUP === "1",
    adminPackageInstall:
      windows && environment.RELEASELENS_ENABLE_PACKAGE_INSTALL === "1",
  };
}

export function unsupportedForCapabilities(
  testId: string,
  required: RunnerCapability[],
  capabilities: RunnerCapabilities,
  startedAt: string,
): BehaviorResult | undefined {
  const missing = required.filter((capability) => !capabilities[capability]);
  if (missing.length === 0) {
    return undefined;
  }
  return {
    testId,
    status: "unsupported",
    startedAt,
    durationMs: 0,
    summary: `Unsupported on this runner: missing ${missing.join(", ")}.`,
    structuredDetails: { missingCapabilities: missing },
  };
}
