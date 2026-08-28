import { describe, expect, it } from "vitest";
import { GitHubReleaseSource } from "./source";
import { fixedContext, fixture } from "../test-helpers";

describe("GitHub release source", () => {
  it("reads public release metadata without treating it as an installer", async () => {
    const source = new GitHubReleaseSource({ repository: "example/tool" });
    const url =
      "https://api.github.com/repos/example/tool/releases?per_page=12";
    const snapshot = await source.discover(
      fixedContext({ [url]: await fixture("sources/github/releases.json") }),
    );
    expect(snapshot.candidates[0]).toMatchObject({
      sourceVersion: "2.1.0",
      discoveryStatus: "metadata-only",
    });
  });
});
