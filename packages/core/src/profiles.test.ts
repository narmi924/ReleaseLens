import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadProductProfiles,
  parseProductProfile,
  ProfileValidationError,
} from "./profiles";

describe("product profiles", () => {
  it("validates the four shipped product profiles", async () => {
    const profiles = await loadProductProfiles(
      resolve(process.cwd(), "products"),
    );
    // Profiles load in locale order of their file names.
    expect(profiles.map((profile) => profile.id)).toEqual([
      "claude-code",
      "codex-cli",
      "codex",
      "gemini-cli",
    ]);
    expect(profiles.every((profile) => profile.tests.length > 0)).toBe(true);
  });

  it("rejects an incomplete profile", () => {
    expect(() =>
      parseProductProfile("id: invalid\nname: Incomplete", "fixture.yaml"),
    ).toThrow(ProfileValidationError);
  });
});
