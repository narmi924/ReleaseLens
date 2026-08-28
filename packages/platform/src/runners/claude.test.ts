import { describe, expect, it } from "vitest";
import { runClaudeNativeSmoke } from "./claude";
import { detectRunnerCapabilities } from "./capabilities";

describe("Claude native smoke", () => {
  it("does not acquire or execute a binary when the runner lacks Windows capability", async () => {
    const outcome = await runClaudeNativeSmoke(
      {
        sourceId: "claude-native",
        observedAt: "2026-08-28T00:00:00.000Z",
        fingerprint: "fixture",
        candidates: [],
        evidence: [],
        state: {
          version: "1.2.3",
          platform: "win32-x64",
          checksum: "a".repeat(64),
          releaseManifestUrl: "https://downloads.claude.ai/manifest.json",
          installScriptUrl: "https://claude.ai/install.ps1",
          installScriptSha256: "b".repeat(64),
        },
        runtimeArtifact: {
          temporaryUrl: new URL("https://downloads.claude.ai/claude.exe"),
          expectedFileName: "claude.exe",
          sourceHost: "downloads.claude.ai",
        },
      },
      "2026-08-28T00:00:00.000Z",
      { ...detectRunnerCapabilities(), windows: false },
    );
    expect(outcome.results[0]?.status).toBe("unsupported");
    expect(outcome.artifact.status).toBe("unsupported");
  });
});
