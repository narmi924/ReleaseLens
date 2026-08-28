import { join, resolve, sep } from "node:path";
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

export type GeminiSmokeOutcome = CliSmokeOutcome & {
  artifact: ArtifactEvidence;
};

function safePackagePath(root: string, relativePath: string): string {
  if (
    !relativePath ||
    relativePath.includes("..") ||
    relativePath.startsWith("/") ||
    relativePath.startsWith("\\")
  ) {
    throw new Error(`Unsafe npm CLI entry: ${relativePath}.`);
  }
  const target = resolve(root, relativePath);
  if (!target.startsWith(`${resolve(root)}${sep}`)) {
    throw new Error("npm CLI entry escaped the extracted package.");
  }
  return target;
}

async function smokeExtractedGemini(
  tarballPath: string,
  inspection: NpmPackageInspection,
  observedAt: string,
  capabilities: RunnerCapabilities,
): Promise<Omit<GeminiSmokeOutcome, "artifact">> {
  const unsupported = unsupportedForCapabilities(
    "gemini-version",
    ["node", "shell"],
    capabilities,
    observedAt,
  );
  if (unsupported) {
    return {
      behavior: behaviorEvidence("gemini-cli", [unsupported], observedAt),
      results: [unsupported],
    };
  }
  if (!inspection.integrity.valid) {
    const failed: BehaviorResult = {
      testId: "gemini-version",
      status: "fail",
      startedAt: observedAt,
      durationMs: 0,
      summary:
        "Gemini CLI was not executed because npm integrity verification failed.",
    };
    return {
      behavior: behaviorEvidence("gemini-cli", [failed], observedAt),
      results: [failed],
    };
  }
  return withArtifactLease("releaselens-gemini-extract", async (lease) => {
    await tar.x({
      file: tarballPath,
      cwd: lease.directory,
      strict: true,
      preservePaths: false,
    });
    const cliEntry = inspection.bin.gemini ?? Object.values(inspection.bin)[0];
    if (!cliEntry) {
      const failed: BehaviorResult = {
        testId: "gemini-version",
        status: "fail",
        startedAt: observedAt,
        durationMs: 0,
        summary: "Gemini npm package has no executable bin entry.",
      };
      return {
        behavior: behaviorEvidence("gemini-cli", [failed], observedAt),
        results: [failed],
      };
    }
    const script = safePackagePath(join(lease.directory, "package"), cliEntry);
    const permit = issueExecutionPermit(
      true,
      "npm integrity and package identity verification passed",
    );
    return runVerifiedCliSmoke({
      permit,
      productId: "gemini-cli",
      cliName: "gemini",
      executable: process.execPath,
      versionArgs: [script, "--version"],
      helpArgs: [script, "--help"],
      observedAt,
    });
  });
}

export async function runGeminiSmoke(
  runtime: NpmRuntimeArtifact,
  observedAt: string,
  capabilities: RunnerCapabilities,
): Promise<GeminiSmokeOutcome> {
  return withArtifactLease("releaselens-gemini", async (lease) => {
    const downloaded = await downloadArtifact(lease, runtime.runtimeArtifact, {
      allowedHost: (host) => host === runtime.runtimeArtifact.sourceHost,
    });
    const inspection = await new NpmPackageInspector().inspect(
      downloaded.filePath,
      {
        packageName: runtime.packageName,
        packageVersion: runtime.version,
        integrity: runtime.integrity,
      },
    );
    const smoke = await smokeExtractedGemini(
      downloaded.filePath,
      inspection,
      observedAt,
      capabilities,
    );
    return {
      ...smoke,
      artifact: npmArtifactEvidence(downloaded, inspection, observedAt),
    };
  });
}

export { smokeExtractedGemini };
