import { describe, expect, it } from "vitest";
import {
  compareQuadVersions,
  compareSemverVersions,
  parsePackageMoniker,
} from "./version";

describe("structural version handling", () => {
  it("compares Store quad versions numerically instead of lexicographically", () => {
    expect(compareQuadVersions("26.100.0.0", "26.99.999.999")).toBeGreaterThan(
      0,
    );
    expect(compareQuadVersions("26.825.3734.0", "26.825.3734.0")).toBe(0);
  });

  it("orders stable semantic versions after their prereleases", () => {
    expect(compareSemverVersions("2.1.0", "2.1.0-preview.1")).toBeGreaterThan(
      0,
    );
    expect(compareSemverVersions("2.10.0", "2.9.9")).toBeGreaterThan(0);
  });

  it("parses a package full name with an empty resource id", () => {
    expect(
      parsePackageMoniker("OpenAI.Codex_26.825.3734.0_x64__2p2nqsd0c76g0"),
    ).toMatchObject({
      name: "OpenAI.Codex",
      architecture: "x64",
      resourceId: "",
      publisherId: "2p2nqsd0c76g0",
      version: [26, 825, 3734, 0],
    });
  });
});
