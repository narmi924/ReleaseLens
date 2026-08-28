import { describe, expect, it } from "vitest";
import { NpmSource } from "./source";
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
});
