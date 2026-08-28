import { describe, expect, it } from "vitest";
import { ClaudeNativeSource } from "./source";
import { fixedContext } from "../test-helpers";

describe("Claude native distribution source", () => {
  it("follows the official script's release endpoint and requires a platform checksum", async () => {
    const base = "https://downloads.claude.ai/claude-code-releases";
    const source = new ClaudeNativeSource();
    const snapshot = await source.discover(
      fixedContext({
        "https://claude.ai/install.ps1":
          "$DOWNLOAD_BASE_URL = 'https://downloads.claude.ai/claude-code-releases'",
        [`${base}/latest`]: "2.3.4\n",
        [`${base}/2.3.4/manifest.json`]: JSON.stringify({
          platforms: { "win32-x64": { checksum: "a".repeat(64) } },
        }),
      }),
    );
    expect(snapshot.state.version).toBe("2.3.4");
    expect(snapshot.candidates[0]?.sourceVersion).toBe("2.3.4");
  });
});
