import { mkdir } from "node:fs/promises";
import { resolve, sep } from "node:path";
import * as tar from "tar";
import type { ArtifactEvidence, BehaviorResult } from "@releaselens/core";
import { downloadArtifact } from "../artifacts/downloader";
import { npmArtifactEvidence } from "../artifacts/evidence";
import { withArtifactLease } from "../artifacts/lease";
import {
  NpmPackageInspector,
  type NpmPackageInspection,
} from "../inspectors/npm-package/inspector";
import type { NpmRuntimeArtifact } from "../sources/npm/source";
import type { RunnerCapabilities } from "./capabilities";
import { unsupportedForCapabilities } from "./capabilities";
import { runVerifiedCliSmoke, type CliSmokeOutcome } from "./cli-smoke";
import { behaviorEvidence } from "./framework";
import { issueExecutionPermit } from "./permit";

export type CodexCliSmokeOutcome = CliSmokeOutcome & {
  artifacts: ArtifactEvidence[];
};

export type VerifiedNpmPackage = {
  tarballPath: string;
  inspection: NpmPackageInspection;
};

const productId = "codex-cli";
const cliName = "codex";
const requiredCapabilities = ["node", "shell", "windows"] as const;
const packageNamePattern =
  /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;

function failedOutcome(
  summary: string,
  observedAt: string,
): Omit<CodexCliSmokeOutcome, "artifacts"> {
  const failed: BehaviorResult = {
    testId: `${cliName}-version`,
    status: "fail",
    startedAt: observedAt,
    durationMs: 0,
    summary,
  };
  return {
    behavior: behaviorEvidence(productId, [failed], observedAt),
    results: [failed],
  };
}

function packageDirectory(root: string, packageName: string): string {
  if (!packageNamePattern.test(packageName)) {
    throw new Error(`Unsafe npm package name: ${packageName}.`);
  }
  const target = resolve(root, "node_modules", ...packageName.split("/"));
  if (!target.startsWith(`${resolve(root)}${sep}`)) {
    throw new Error("npm package directory escaped the extracted layout.");
  }
  return target;
}

function safePackagePath(root: string, relativePath: string): string {
  if (
    !relativePath ||
    relativePath.includes("..") ||
    relativePath.startsWith("/") ||
    relativePath.startsWith(sep)
  ) {
    throw new Error(`Unsafe npm CLI entry: ${relativePath}.`);
  }
  const target = resolve(root, relativePath);
  if (!target.startsWith(`${resolve(root)}${sep}`)) {
    throw new Error("npm CLI entry escaped the extracted package.");
  }
  return target;
}

async function extractPackage(
  tarballPath: string,
  directory: string,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  await tar.x({
    file: tarballPath,
    cwd: directory,
    strip: 1,
    strict: true,
    preservePaths: false,
  });
}

function platformArchitecture(
  dependency: string,
): ArtifactEvidence["architecture"] {
  if (/arm64/i.test(dependency)) return "arm64";
  if (/x64|amd64/i.test(dependency)) return "x64";
  return undefined;
}

/**
 * Lays the verified wrapper and platform package out exactly as npm would,
 * with node_modules/@openai/codex next to node_modules/@openai/codex-win32-x64,
 * and runs the published launcher through the observer Node runtime.  Nothing
 * is installed globally and no registry client runs; the launcher resolves
 * the platform binary with the same require.resolve lookup users rely on.
 */
export async function smokeExtractedCodexCli(
  wrapper: VerifiedNpmPackage,
  platform: VerifiedNpmPackage & { dependency: string },
  observedAt: string,
  capabilities: RunnerCapabilities,
): Promise<Omit<CodexCliSmokeOutcome, "artifacts">> {
  const unsupported = unsupportedForCapabilities(
    `${cliName}-version`,
    [...requiredCapabilities],
    capabilities,
    observedAt,
  );
  if (unsupported) {
    return {
      behavior: behaviorEvidence(productId, [unsupported], observedAt),
      results: [unsupported],
    };
  }
  if (!wrapper.inspection.integrity.valid) {
    return failedOutcome(
      "Codex CLI was not executed because the wrapper package failed npm integrity verification.",
      observedAt,
    );
  }
  if (!platform.inspection.integrity.valid) {
    return failedOutcome(
      "Codex CLI was not executed because the platform binary package failed npm integrity verification.",
      observedAt,
    );
  }
  const cliEntry =
    wrapper.inspection.bin[cliName] ?? Object.values(wrapper.inspection.bin)[0];
  if (!cliEntry) {
    return failedOutcome(
      "Codex CLI wrapper package has no executable bin entry.",
      observedAt,
    );
  }
  return withArtifactLease("releaselens-codex-cli-layout", async (lease) => {
    const wrapperDirectory = packageDirectory(
      lease.directory,
      wrapper.inspection.packageName,
    );
    const platformDirectory = packageDirectory(
      lease.directory,
      platform.dependency,
    );
    await extractPackage(wrapper.tarballPath, wrapperDirectory);
    await extractPackage(platform.tarballPath, platformDirectory);
    const script = safePackagePath(wrapperDirectory, cliEntry);
    const permit = issueExecutionPermit(
      true,
      "npm integrity and package identity verification passed for the wrapper and the platform binary package",
    );
    return runVerifiedCliSmoke({
      permit,
      productId,
      cliName,
      executable: process.execPath,
      versionArgs: [script, "--version"],
      helpArgs: [script, "--help"],
      observedAt,
    });
  });
}

function unsupportedArtifact(
  runtime: NpmRuntimeArtifact,
  observedAt: string,
): ArtifactEvidence {
  return {
    id: `artifact:npm:${runtime.packageName}:${runtime.version}`,
    kind: "artifact",
    status: "unsupported",
    summary:
      "Codex CLI platform binary acquisition is unsupported on this runner.",
    observedAt,
    fileName: runtime.runtimeArtifact.expectedFileName,
    format: "npm-tgz",
    sourceHost: runtime.runtimeArtifact.sourceHost,
    packageIdentity: runtime.packageName,
    packageVersion: runtime.version,
    verification: [],
  };
}

export async function runCodexCliSmoke(
  runtime: NpmRuntimeArtifact,
  observedAt: string,
  capabilities: RunnerCapabilities,
): Promise<CodexCliSmokeOutcome> {
  const unsupported = unsupportedForCapabilities(
    `${cliName}-version`,
    [...requiredCapabilities],
    capabilities,
    observedAt,
  );
  if (unsupported) {
    // Do not pull a large platform binary onto a runner that cannot execute it.
    return {
      behavior: behaviorEvidence(productId, [unsupported], observedAt),
      results: [unsupported],
      artifacts: [unsupportedArtifact(runtime, observedAt)],
    };
  }
  return withArtifactLease("releaselens-codex-cli", async (lease) => {
    const wrapperDownload = await downloadArtifact(
      lease,
      runtime.runtimeArtifact,
      {
        allowedHost: (host) => host === runtime.runtimeArtifact.sourceHost,
      },
    );
    const wrapperInspection = await new NpmPackageInspector().inspect(
      wrapperDownload.filePath,
      {
        packageName: runtime.packageName,
        packageVersion: runtime.version,
        integrity: runtime.integrity,
      },
    );
    const wrapperArtifact = npmArtifactEvidence(
      wrapperDownload,
      wrapperInspection,
      observedAt,
    );
    const platform = runtime.platform;
    if (!platform) {
      const outcome = failedOutcome(
        "Codex CLI was not executed because npm metadata did not resolve a platform binary package.",
        observedAt,
      );
      return { ...outcome, artifacts: [wrapperArtifact] };
    }
    const platformDownload = await downloadArtifact(
      lease,
      platform.runtimeArtifact,
      {
        allowedHost: (host) => host === platform.runtimeArtifact.sourceHost,
      },
    );
    const platformInspection = await new NpmPackageInspector().inspect(
      platformDownload.filePath,
      {
        packageName: platform.packageName,
        packageVersion: platform.version,
        integrity: platform.integrity,
      },
    );
    const architecture = platformArchitecture(platform.dependency);
    const platformArtifact: ArtifactEvidence = {
      ...npmArtifactEvidence(platformDownload, platformInspection, observedAt),
      ...(architecture ? { architecture } : {}),
    };
    const smoke = await smokeExtractedCodexCli(
      { tarballPath: wrapperDownload.filePath, inspection: wrapperInspection },
      {
        tarballPath: platformDownload.filePath,
        inspection: platformInspection,
        dependency: platform.dependency,
      },
      observedAt,
      capabilities,
    );
    return { ...smoke, artifacts: [wrapperArtifact, platformArtifact] };
  });
}
