import type { ArtifactEvidence } from "@releaselens/core";
import { downloadArtifact } from "../artifacts/downloader";
import { withArtifactLease } from "../artifacts/lease";
import type { ClaudeNativeSourceSnapshot } from "../sources/claude/source";
import type { RunnerCapabilities } from "./capabilities";
import { unsupportedForCapabilities } from "./capabilities";
import { runVerifiedCliSmoke, type CliSmokeOutcome } from "./cli-smoke";
import { behaviorEvidence } from "./framework";
import { issueExecutionPermit } from "./permit";

export type ClaudeSmokeOutcome = CliSmokeOutcome & {
  artifact: ArtifactEvidence;
};

export async function runClaudeNativeSmoke(
  source: ClaudeNativeSourceSnapshot,
  observedAt: string,
  capabilities: RunnerCapabilities,
): Promise<ClaudeSmokeOutcome> {
  const unsupported = unsupportedForCapabilities(
    "claude-version",
    ["windows", "shell"],
    capabilities,
    observedAt,
  );
  if (unsupported) {
    const artifact: ArtifactEvidence = {
      id: `artifact:claude-native:${source.state.version}`,
      kind: "artifact",
      status: "unsupported",
      summary:
        "Claude native artifact acquisition is unsupported on this runner.",
      observedAt,
      fileName: source.runtimeArtifact.expectedFileName,
      format: "windows-exe",
      sourceHost: source.runtimeArtifact.sourceHost,
      packageIdentity: "Anthropic.ClaudeCode",
      packageVersion: source.state.version,
      verification: [],
    };
    return {
      behavior: behaviorEvidence("claude-code", [unsupported], observedAt),
      results: [unsupported],
      artifact,
    };
  }
  return withArtifactLease("releaselens-claude", async (lease) => {
    const downloaded = await downloadArtifact(lease, source.runtimeArtifact, {
      expectedSha256: source.state.checksum,
      allowedHost: (host) => host === "downloads.claude.ai",
    });
    const permit = issueExecutionPermit(
      true,
      "Anthropic native release manifest SHA-256 matched the downloaded executable",
    );
    const smoke = await runVerifiedCliSmoke({
      permit,
      productId: "claude-code",
      cliName: "claude",
      executable: downloaded.filePath,
      doctorArgs: ["doctor"],
      doctorOptional: true,
      observedAt,
    });
    const artifact: ArtifactEvidence = {
      id: `artifact:claude-native:${source.state.version}`,
      kind: "artifact",
      status: "pass",
      summary: `Claude Code native ${source.state.version} executable matched the official release manifest SHA-256.`,
      observedAt,
      fileName: downloaded.fileName,
      format: "windows-exe",
      sourceHost: downloaded.sourceHost,
      sizeBytes: downloaded.sizeBytes,
      sha256: downloaded.sha256,
      packageIdentity: "Anthropic.ClaudeCode",
      packageVersion: source.state.version,
      architecture: source.state.platform.endsWith("arm64") ? "arm64" : "x64",
      verification: [
        {
          id: "claude-manifest-sha256",
          kind: "verification",
          status: "pass",
          summary:
            "Downloaded native executable matches Anthropic's manifest SHA-256.",
          observedAt,
        },
      ],
    };
    return { ...smoke, artifact };
  });
}
