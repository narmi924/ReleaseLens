import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  canonicalSha256,
  PersistedStateSafetyError,
} from "./canonical";

describe("canonical persistence", () => {
  it("sorts keys and has a stable fingerprint", () => {
    const first = { z: 1, nested: { b: true, a: "value" }, a: ["x", "y"] };
    const second = { a: ["x", "y"], nested: { a: "value", b: true }, z: 1 };
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(canonicalSha256(first)).toBe(canonicalSha256(second));
  });

  it("refuses a temporary delivery URL or credential-shaped field", () => {
    expect(() =>
      canonicalJson({
        url: "https://tlu.dl.delivery.mp.microsoft.com/file.msix?sig=secret",
      }),
    ).toThrow(PersistedStateSafetyError);
    expect(() => canonicalJson({ authorization: "Bearer secret" })).toThrow(
      PersistedStateSafetyError,
    );
    expect(() =>
      canonicalJson({
        sourceUrl: "https://example.invalid/file?access_token=secret",
      }),
    ).toThrow(PersistedStateSafetyError);
  });

  it("refuses embedded signed delivery URLs and local temporary paths", () => {
    expect(() =>
      canonicalJson({
        error:
          "failed https://x.dl.delivery.mp.microsoft.com/file.msix?token=secret",
      }),
    ).toThrow(PersistedStateSafetyError);
    expect(() =>
      canonicalJson({
        summary:
          "failed at C:\\Users\\example\\AppData\\Local\\Temp\\artifact.msix",
      }),
    ).toThrow(PersistedStateSafetyError);
    expect(() =>
      canonicalJson({
        summary: "failed at E:\\Projects\\ReleaseLens\\artifact.msix",
      }),
    ).toThrow(PersistedStateSafetyError);
    expect(
      canonicalJson({ sourceUrl: "https://docs.github.com/en/rest" }),
    ).toContain("docs.github.com");
  });
});
