import { describe, expect, it } from "vitest";
import { NpmSource, parsePlatformDependencySpec } from "./source";
import { fixedContext, fixture } from "../test-helpers";

describe("npm channel source", () => {
  it("keeps latest, preview, and nightly as independent channel candidates with integrity", async () => {
    const url = "https://registry.npmjs.org/%40google%2Fgemini-cli";
    const source = new NpmSource({
      packageName: "@google/gemini-cli",
      channels: ["latest", "preview", "nightly"],
    });
    const snapshot = await source.discover(
      fixedContext({ [url]: await fixture("sources/npm/gemini.json") }),
    );
    expect(
      snapshot.candidates.map(
        (candidate) => `${candidate.channel}:${candidate.sourceVersion}`,
      ),
    ).toEqual([
      "latest:0.50.0",
      "preview:0.51.0-preview.1",
      "nightly:0.52.0-nightly.20260828.gabcdef",
    ]);
    expect(snapshot.state.channels[0]?.integrity).toContain("sha512");
  });

  it("resolves the pinned platform binary package behind an npm alias optional dependency", async () => {
    const url = "https://registry.npmjs.org/%40openai%2Fcodex";
    const source = new NpmSource({
      packageName: "@openai/codex",
      channels: ["latest", "alpha"],
      platformDependency: "@openai/codex-win32-x64",
    });
    const snapshot = await source.discover(
      fixedContext({ [url]: await fixture("sources/npm/codex.json") }),
    );
    expect(
      snapshot.candidates.map(
        (candidate) => `${candidate.channel}:${candidate.sourceVersion}`,
      ),
    ).toEqual(["latest:0.158.0", "alpha:0.159.0-alpha.12"]);
    const latest = snapshot.runtimeArtifacts.get("latest:0.158.0")!;
    expect(latest.runtimeArtifact.expectedFileName).toBe("codex-0.158.0.tgz");
    expect(latest.platform).toMatchObject({
      dependency: "@openai/codex-win32-x64",
      packageName: "@openai/codex",
      version: "0.158.0-win32-x64",
      integrity: "sha512-fixtureplatformlatest",
    });
    expect(latest.platform?.runtimeArtifact.expectedFileName).toBe(
      "codex-0.158.0-win32-x64.tgz",
    );
    expect(snapshot.state.channels).toMatchObject([
      {
        channel: "latest",
        version: "0.158.0",
        platformPackage: {
          dependency: "@openai/codex-win32-x64",
          version: "0.158.0-win32-x64",
          shasum: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      },
      {
        channel: "alpha",
        version: "0.159.0-alpha.12",
        platformPackage: { version: "0.159.0-alpha.12-win32-x64" },
      },
    ]);
  });

  it("refuses a platform dependency that is not pinned to an exact version", () => {
    expect(
      parsePlatformDependencySpec(
        "@openai/codex-win32-x64",
        "npm:@openai/codex@0.158.0-win32-x64",
      ),
    ).toEqual({ packageName: "@openai/codex", version: "0.158.0-win32-x64" });
    expect(
      parsePlatformDependencySpec(
        "@anthropic-ai/claude-code-win32-x64",
        "2.1.283",
      ),
    ).toEqual({
      packageName: "@anthropic-ai/claude-code-win32-x64",
      version: "2.1.283",
    });
    expect(() =>
      parsePlatformDependencySpec("@openai/codex-win32-x64", "^0.158.0"),
    ).toThrow(/not pinned/);
  });
});
