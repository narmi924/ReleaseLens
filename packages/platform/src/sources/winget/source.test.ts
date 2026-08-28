import { describe, expect, it } from "vitest";
import { parseWinGetShowOutput, WinGetSource } from "./source";
import { fixedContext } from "../test-helpers";

describe("WinGet source", () => {
  it("selects the latest structured manifest rather than lexical directory order", async () => {
    const root =
      "https://api.github.com/repos/microsoft/winget-pkgs/contents/manifests/a/Anthropic/ClaudeCode?ref=master";
    const directory =
      "https://api.github.com/repos/microsoft/winget-pkgs/contents/manifests/a/Anthropic/ClaudeCode/2.10.0?ref=master";
    const manifestUrl =
      "https://raw.githubusercontent.com/microsoft/winget-pkgs/master/manifest.yaml";
    const source = new WinGetSource({ packageId: "Anthropic.ClaudeCode" });
    const snapshot = await source.discover(
      fixedContext({
        [root]: JSON.stringify([
          { name: "2.9.9", type: "dir" },
          { name: "2.10.0", type: "dir" },
        ]),
        [directory]: JSON.stringify([
          {
            name: "Anthropic.ClaudeCode.installer.yaml",
            type: "file",
            download_url: manifestUrl,
          },
        ]),
        [manifestUrl]: [
          "PackageIdentifier: Anthropic.ClaudeCode",
          "PackageVersion: 2.10.0",
          "Installers:",
          "  - Architecture: x64",
          "    InstallerType: exe",
          "    InstallerUrl: https://downloads.claude.ai/claude.exe",
          `    InstallerSha256: ${"b".repeat(64)}`,
        ].join("\n"),
      }),
    );
    expect(snapshot.state.version).toBe("2.10.0");
    expect(snapshot.state.installers[0]?.sourceHost).toBe(
      "downloads.claude.ai",
    );
    expect(snapshot.state.discoveryMethod).toBe("github-api");
  });

  it("uses a read-only WinGet client fallback when GitHub's anonymous API is rate limited", async () => {
    const source = new WinGetSource({
      packageId: "Anthropic.ClaudeCode",
      client: {
        async show() {
          return [
            "Found Claude Code [Anthropic.ClaudeCode]",
            "Version: 2.1.248",
            "Installer URL: https://downloads.claude.ai/claude-code-releases/2.1.248/win32-x64/claude.exe",
            `Installer SHA256: ${"c".repeat(64)}`,
            "Installer Type: portable",
          ].join("\n");
        },
      },
    });
    const snapshot = await source.discover(
      fixedContext(
        {},
        {
          fetch: async () =>
            new Response('{"message":"API rate limit exceeded"}', {
              status: 403,
            }),
        },
      ),
    );
    expect(snapshot.state).toMatchObject({
      version: "2.1.248",
      discoveryMethod: "winget-client",
    });
    expect(snapshot.state.installers[0]).toMatchObject({
      sourceHost: "downloads.claude.ai",
      sha256: "c".repeat(64),
    });
  });

  it("parses the localized fields emitted by winget show", () => {
    expect(
      parseWinGetShowOutput(
        "已找到 Claude Code\n版本: 2.1.248\n安装程序 SHA256: " + "d".repeat(64),
      ),
    ).toMatchObject({
      version: "2.1.248",
      installer: { InstallerSha256: "d".repeat(64) },
    });
  });
});
